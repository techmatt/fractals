//! Fixed-point reals, as `n` little-endian `u64` limbs in two's complement.
//!
//! The top limb is the signed integer part and the `n-1` below it are the
//! fraction, so the value is `w[n-1] + w[n-2..0] / 2^(64(n-1))` and a limb count
//! buys exactly 64 fraction bits. The reference orbit is the only thing computed
//! this way: it runs once per frame, and everything per-sample is `f64`.
//!
//! **Why fixed point and not a float bignum.** The audit priced four options for
//! a 50,000-iteration reference orbit at ~128 bits
//! (`audit_deep_mode_seam_ckpt135` part 1 §5): astro-float at 134 KB of wasm and
//! 26 ms, dashu-float at 220 KB and 55 ms, double-double at 3.6 KB and 2.0 ms,
//! and this at 7.3 KB and 3.8 ms. Double-double is faster and smaller and is
//! still the wrong answer, because its 106 bits are a ceiling: there is no way to
//! ask it for more, and a view at 1e-30 wants 166. A limb count read off the view
//! is the whole point.
//!
//! **Written for wasm32, which has no 64×64→128 multiply.** The audit measured
//! this arithmetic 3.9× slower in wasm than native when its inner product went
//! through `u128`, because every one of those became a `__multi3` call. Here a
//! limb is split into two `u32` halves and the partial product is `u32 × u32 →
//! u64`, which is a single `i64.mul` after two zero-extends on wasm and a plain
//! 32-bit multiply on x86-64. Nothing in this file names `u128`.
//!
//! Multiplication truncates toward zero at the last fraction bit. That is a
//! sub-ulp error on a number carrying 64 guard bits past what the view can
//! resolve, and it is what the archive's own reference orbit does.

/// The widest number this module will form: 15 fraction limbs, 960 fraction bits.
///
/// [`limbs_for`](crate::reference::limbs_for) reaches it at a view about 1e-280
/// across, which is past where `f64` can hold the view *width* at all — so the
/// ceiling is not a policy, it is the end of the coordinate system.
pub const MAX_LIMBS: usize = 16;

/// A fixed-point real. `n` is the limb count, and two numbers are only ever
/// combined at the same one.
#[derive(Clone, Copy, Debug)]
pub struct Fx {
    /// Limbs in use, `2..=MAX_LIMBS`.
    pub n: usize,
    /// Little-endian limbs. Only the first `n` are meaningful.
    pub w: [u64; MAX_LIMBS],
}

/// Half-limb `i` of a limb array: `u32`s, little-endian within the `u64`.
#[inline(always)]
fn half(w: &[u64; MAX_LIMBS], i: usize) -> u32 {
    (w[i >> 1] >> (32 * (i & 1))) as u32
}

impl Fx {
    /// Zero, at `n` limbs.
    pub fn zero(n: usize) -> Self {
        Fx {
            n,
            w: [0; MAX_LIMBS],
        }
    }

    /// Whether the number is negative — the sign bit of the integer limb.
    #[inline(always)]
    pub fn is_neg(&self) -> bool {
        (self.w[self.n - 1] as i64) < 0
    }

    #[inline(always)]
    pub fn neg(&self) -> Self {
        let mut r = Fx::zero(self.n);
        let mut carry = 1u64;
        for i in 0..self.n {
            let (s, c) = (!self.w[i]).overflowing_add(carry);
            r.w[i] = s;
            carry = c as u64;
        }
        r
    }

    #[inline(always)]
    pub fn add(&self, b: &Self) -> Self {
        let mut r = Fx::zero(self.n);
        let mut carry = 0u64;
        for i in 0..self.n {
            let (s1, c1) = self.w[i].overflowing_add(b.w[i]);
            let (s2, c2) = s1.overflowing_add(carry);
            r.w[i] = s2;
            carry = (c1 as u64) + (c2 as u64);
        }
        r
    }

    #[inline(always)]
    pub fn sub(&self, b: &Self) -> Self {
        self.add(&b.neg())
    }

    /// Doubling, which the imaginary half of a complex square needs and which is
    /// a shift rather than a multiply.
    #[inline(always)]
    pub fn shl1(&self) -> Self {
        let mut r = Fx::zero(self.n);
        let mut carry = 0u64;
        for i in 0..self.n {
            r.w[i] = (self.w[i] << 1) | carry;
            carry = self.w[i] >> 63;
        }
        r
    }

    #[inline(always)]
    fn abs(&self) -> (bool, Self) {
        if self.is_neg() {
            (true, self.neg())
        } else {
            (false, *self)
        }
    }

    /// The product, truncated at the last fraction bit.
    ///
    /// Schoolbook over `2n` half-limbs. The full product is `2n` limbs and the
    /// answer is the window starting at limb `n-1`, because both operands carry
    /// `64(n-1)` fraction bits and the product carries twice that.
    pub fn mul(&self, b: &Self) -> Self {
        let n = self.n;
        let (sa, a) = self.abs();
        let (sb, b) = b.abs();
        let halves = 2 * n;

        // `4 * MAX_LIMBS` half-limbs is `2 * MAX_LIMBS` limbs, which is the widest
        // product two `MAX_LIMBS` numbers can have.
        let mut p = [0u32; 4 * MAX_LIMBS];
        for i in 0..halves {
            let ai = half(&a.w, i) as u64;
            if ai == 0 {
                continue;
            }
            let mut carry = 0u64;
            for j in 0..halves {
                // Every term fits: (2^32−1)² + 2·(2^32−1) is exactly 2^64−1.
                let t = ai * (half(&b.w, j) as u64) + (p[i + j] as u64) + carry;
                p[i + j] = t as u32;
                carry = t >> 32;
            }
            p[i + halves] = carry as u32;
        }

        let mut r = Fx::zero(n);
        for k in 0..n {
            let src = 2 * (n - 1 + k);
            r.w[k] = (p[src] as u64) | ((p[src + 1] as u64) << 32);
        }
        if sa ^ sb { r.neg() } else { r }
    }

    #[inline(always)]
    pub fn sqr(&self) -> Self {
        self.mul(self)
    }

    /// The nearest `f64`, by summing the limbs from the top down.
    ///
    /// The sum is exact until the limbs run past 53 bits of significance and then
    /// rounds, which is what a projection to `f64` is for. It never formats a
    /// decimal on the way — the archive's `to_f64` read raw mantissa bits for the
    /// same reason, and this arrives at the same place without assuming a word
    /// size.
    pub fn to_f64(&self) -> f64 {
        let (neg, m) = self.abs();
        let mut v = 0.0f64;
        // Two limbs from the top non-zero one is 128 bits of significance, which
        // cannot be moved by anything below it at 53. Stopping there is what keeps
        // this cheap enough to call twice per reference step.
        let mut taken = 0;
        for i in (0..self.n).rev() {
            if taken == 0 && m.w[i] == 0 {
                continue;
            }
            v += m.w[i] as f64 * pow2(64 * (i as i32 - (self.n as i32 - 1)));
            taken += 1;
            if taken == 2 {
                break;
            }
        }
        if neg { -v } else { v }
    }

    /// An `f64` placed exactly, truncated toward zero at the last fraction bit.
    ///
    /// This is how a *geometry* offset — which is `f64`, and correctly so, being
    /// a distance across a frame rather than a position on the plane — enters an
    /// exact coordinate. Nothing in the kernel needs it; the brute-force oracle
    /// the crate is held against does, because that oracle has to iterate the
    /// same point the kernel perturbs.
    ///
    /// `None` for anything the integer limb cannot hold, and for a non-finite.
    pub fn from_f64(value: f64, n: usize) -> Option<Self> {
        if !value.is_finite() || value.abs() >= 4.611686018427388e18 {
            return None;
        }
        if value == 0.0 {
            return Some(Fx::zero(n));
        }
        let magnitude = value.abs();
        let bits = magnitude.to_bits();
        let raw_exponent = ((bits >> 52) & 0x7ff) as i32;
        let fraction = bits & ((1u64 << 52) - 1);
        let (mantissa, exponent) = if raw_exponent == 0 {
            (fraction, -1074)
        } else {
            (fraction | (1u64 << 52), raw_exponent - 1075)
        };

        let mut out = Fx::zero(n);
        let shift = exponent + 64 * (n as i32 - 1);
        let top = 64 * n as i32;
        for bit in 0..53 {
            if mantissa & (1u64 << bit) != 0 {
                let at = shift + bit;
                if at >= 0 && at < top {
                    out.w[at as usize / 64] |= 1u64 << (at as usize % 64);
                }
            }
        }
        Some(if value < 0.0 { out.neg() } else { out })
    }

    /// The number a plain decimal string spells, truncated to `n` limbs.
    ///
    /// **A centre arrives as text and is never narrowed to `f64` on the way in.**
    /// That is the whole reason this function exists: `str::parse::<f64>` is what
    /// the engine's own `spec::decimal` does, and it throws away every digit past
    /// the seventeenth — which at 1e-28 is every digit that says where the view
    /// is.
    ///
    /// Accepts a leading sign, digits, one point, and an optional `e±k`
    /// exponent. Returns `None` on anything else, including a value too large for
    /// the integer limb.
    pub fn parse(text: &str, n: usize) -> Option<Self> {
        let text = text.trim();
        let (neg, body) = match text.strip_prefix('-') {
            Some(rest) => (true, rest),
            None => (false, text.strip_prefix('+').unwrap_or(text)),
        };
        let (body, exponent) = match body.find(['e', 'E']) {
            Some(at) => (&body[..at], body[at + 1..].parse::<i32>().ok()?),
            None => (body, 0),
        };
        // Past this the point-shift below would build a digit string longer than
        // any number this type can hold, and the answer is a refusal either way.
        if exponent.abs() > 512 {
            return None;
        }
        let (int_text, frac_text) = body.split_once('.').unwrap_or((body, ""));
        if int_text.is_empty() && frac_text.is_empty() {
            return None;
        }

        // Shift the point by the exponent textually, so that `2e-11` and
        // `0.00000000002` take exactly the same path and neither touches `f64`.
        let mut digits: Vec<u8> = Vec::with_capacity(int_text.len() + frac_text.len() + 8);
        for byte in int_text.bytes().chain(frac_text.bytes()) {
            if !byte.is_ascii_digit() {
                return None;
            }
            digits.push(byte - b'0');
        }
        let mut point = int_text.len() as i32 + exponent;
        while point < 0 {
            digits.insert(0, 0);
            point += 1;
        }
        while point as usize > digits.len() {
            digits.push(0);
        }
        let (int_digits, frac_digits) = digits.split_at(point as usize);

        let mut integer: u64 = 0;
        for &digit in int_digits {
            integer = integer.checked_mul(10)?.checked_add(digit as u64)?;
        }
        if integer > i64::MAX as u64 {
            return None;
        }

        let mut value = Fx::zero(n);
        value.w[n - 1] = integer;
        // The binary expansion of the decimal fraction, by repeated doubling:
        // exact, and it needs no division.
        let mut frac: Vec<u8> = frac_digits.to_vec();
        let bits = 64 * (n - 1);
        for bit in 0..bits {
            let mut carry = 0u8;
            for digit in frac.iter_mut().rev() {
                let doubled = *digit * 2 + carry;
                *digit = doubled % 10;
                carry = doubled / 10;
            }
            if carry == 1 {
                let position = bits - 1 - bit;
                value.w[position / 64] |= 1u64 << (position % 64);
            }
        }
        Some(if neg { value.neg() } else { value })
    }
}

/// `2^k`, without `powi`'s loop and without libm.
fn pow2(k: i32) -> f64 {
    // Sub-normal territory is unreachable here — `k` is a multiple of 64 between
    // −960 and 0 — but the halving keeps the function total.
    if k >= -1022 {
        f64::from_bits(((k + 1023) as u64) << 52)
    } else {
        f64::from_bits(1) * pow2(k + 1074)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fx(text: &str) -> Fx {
        Fx::parse(text, 4).unwrap()
    }

    #[test]
    fn a_decimal_round_trips_through_f64_at_the_top() {
        assert!((fx("-0.745017728285323").to_f64() - -0.745017728285323).abs() < 1e-15);
        assert_eq!(fx("0").to_f64(), 0.0);
        assert_eq!(fx("-2").to_f64(), -2.0);
        assert_eq!(fx("1.5").to_f64(), 1.5);
    }

    #[test]
    fn the_exponent_form_and_the_written_out_form_agree() {
        let a = Fx::parse("2e-11", 5).unwrap();
        let b = Fx::parse("0.00000000002", 5).unwrap();
        assert!(a.sub(&b).to_f64() == 0.0);
        let c = Fx::parse("-1.25e2", 4).unwrap();
        assert_eq!(c.to_f64(), -125.0);
    }

    /// The digits `f64` cannot hold are the point of the type, so the test is
    /// that a difference *below* the `f64` floor comes out exactly.
    #[test]
    fn two_centres_differing_past_the_f64_floor_subtract_exactly() {
        let a = fx("-0.74501772828532335842941892835857434");
        let b = fx("-0.74501772828532335842941892835857400");
        let difference = a.sub(&b).to_f64();
        // `a` is the more negative of the two, so the difference is too. Four
        // limbs truncate at 2^-192, which is nothing beside 3.4e-34.
        assert!(
            (difference + 3.4e-34).abs() < 1e-50,
            "difference was {difference:e}"
        );
        // And the same subtraction done the way the engine would: nothing left.
        let narrowed = -0.74501772828532335842941892835857434f64
            - -0.74501772828532335842941892835857400f64;
        assert_eq!(narrowed, 0.0);
    }

    #[test]
    fn multiplication_is_exact_where_it_can_be_and_truncates_toward_zero() {
        assert_eq!(fx("1.5").mul(&fx("-2.5")).to_f64(), -3.75);
        assert_eq!(fx("0.5").sqr().to_f64(), 0.25);
        // A third is not a binary fraction, and truncation keeps the product
        // just under one — by less than an f64 can see, which is why the test
        // asks the fixed-point value rather than its projection.
        let third = fx("0.333333333333333333333333333333333333333333333333333333333333");
        let product = third.mul(&fx("3"));
        assert_eq!(product.to_f64(), 1.0);
        assert!(product.sub(&fx("1")).is_neg());
    }

    #[test]
    fn doubling_is_the_shift_and_the_add() {
        for text in ["0.7", "-0.7", "1.0", "-3.25"] {
            let value = fx(text);
            assert_eq!(value.shl1().to_f64(), value.add(&value).to_f64());
        }
    }

    #[test]
    fn a_wider_limb_count_carries_more_of_the_same_number() {
        let text = "0.1000000000000000000000000000000000000000000000001";
        let narrow = Fx::parse(text, 3).unwrap();
        let wide = Fx::parse(text, 6).unwrap();
        // Both agree with 0.1 in `f64`; only the wide one still knows it is not 0.1.
        assert_eq!(narrow.to_f64(), 0.1);
        assert_eq!(wide.to_f64(), 0.1);
        let tenth_wide = Fx::parse("0.1", 6).unwrap();
        assert!(wide.sub(&tenth_wide).to_f64() > 0.0);
    }

    #[test]
    fn an_f64_lands_where_the_decimal_for_it_lands() {
        for value in [0.0, 1.0, -1.0, 0.5, -0.125, 3.0, 1e-30, -2.5e-20] {
            let placed = Fx::from_f64(value, 6).unwrap();
            assert_eq!(placed.to_f64(), value, "{value:e}");
        }
        // And it composes with the decimal path: a centre plus an offset.
        let centre = fx("-0.7450177282853233584294189");
        let moved = centre.add(&Fx::from_f64(4e-14, 4).unwrap());
        assert!((moved.sub(&centre).to_f64() - 4e-14).abs() < 1e-28);
        assert!(Fx::from_f64(f64::NAN, 4).is_none());
        assert!(Fx::from_f64(1e30, 4).is_none());
    }

    #[test]
    fn nonsense_is_refused_rather_than_guessed() {
        assert!(Fx::parse("", 3).is_none());
        assert!(Fx::parse("1.2.3", 3).is_none());
        assert!(Fx::parse("nan", 3).is_none());
        assert!(Fx::parse("0x10", 3).is_none());
        assert!(Fx::parse("1e999999", 3).is_none());
    }
}
