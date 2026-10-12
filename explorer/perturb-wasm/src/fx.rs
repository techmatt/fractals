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
//! 32-bit multiply on x86-64. Nothing in this file names `u128`. The hot
//! multiplies now go further the same way: 29-bit digits, whose products a column
//! can sum without splitting them (see [`STRAIGHT`]).
//!
//! Multiplication truncates toward zero at the last fraction bit. That is a
//! sub-ulp error on a number carrying 64 guard bits past what the view can
//! resolve, and it is what the archive's own reference orbit does.

/// The widest number this module will form: 15 fraction limbs, 960 fraction bits.
///
/// [`limbs_for`](crate::reference::limbs_for) reaches it at about 2e-248 across and is
/// clamped by it below about 9e-268, at 480 samples across — both still ordinary doubles,
/// so this is a policy; a `z = 0` Julia frame needs `d×` the bits and meets it far sooner.
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

/// Half-limb `i` of a limb array: `u32`s, little-endian within the `u64`. Only
/// the unspecialized reference multiply in the tests reads limbs this way now.
#[cfg(test)]
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
    /// The full product of the magnitudes is `2n` limbs and the answer is the
    /// window starting at limb `n-1`, because both operands carry `64(n-1)`
    /// fraction bits and the product carries twice that; the sign goes on after.
    ///
    /// **The limb count is a constant inside the multiply, not a variable**,
    /// which is what [`mul_at`] is for *(deep_refactor_ckpt138)*: every trip count
    /// is known where it used to be read from `self`. §4 of the crate README has
    /// what that was worth.
    ///
    /// **The window is the exact product's, and it is found without most of the
    /// product.** [`product`] sums only the columns that can reach the window,
    /// with a proof that the ones it skips cannot and a check that falls back to
    /// the whole sum in the rare case the proof does not cover — so the answer is
    /// bit for bit the schoolbook product's, truncated toward zero, and
    /// `tests/orbit_parity.rs` pins the reference orbit to the bytes it was before.
    pub fn mul(&self, b: &Self) -> Self {
        // Each arm is a whole specialization, and the compiler knows every trip
        // count in it. `n` is `2..=MAX_LIMBS` by construction — `Fx::zero`,
        // `parse` and `from_f64` are the only ways to make one — and the widest
        // arm stands in for anything that ever got past them.
        macro_rules! at {
            ($($n:literal)*) => {
                match self.n {
                    $($n => self.mul_at::<$n>(b),)*
                    _ => self.mul_at::<MAX_LIMBS>(b),
                }
            };
        }
        at! { 2 3 4 5 6 7 8 9 10 11 12 13 14 15 }
    }

    /// The multiply at a known limb count.
    #[inline(never)]
    fn mul_at<const N: usize>(&self, b: &Self) -> Self {
        let (sa, a) = magnitude::<N>(&self.w);
        let (sb, b) = magnitude::<N>(&b.w);
        finish::<N>(&product::<N, false>(&a, &b), sa ^ sb)
    }

    /// The square, truncated exactly where [`Fx::mul`] of the number by itself
    /// truncates — it *is* that product, computed with each cross term once.
    pub fn sqr(&self) -> Self {
        macro_rules! at {
            ($($n:literal)*) => {
                match self.n {
                    $($n => self.sqr_at::<$n>(),)*
                    _ => self.sqr_at::<MAX_LIMBS>(),
                }
            };
        }
        at! { 2 3 4 5 6 7 8 9 10 11 12 13 14 15 }
    }

    #[inline(never)]
    fn sqr_at<const N: usize>(&self) -> Self {
        let (_, a) = magnitude::<N>(&self.w);
        finish::<N>(&product::<N, true>(&a, &a), false)
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

    /// The exact decimal, truncated toward zero at `places` fraction digits.
    ///
    /// **This is how a coordinate computed here becomes a coordinate a link can
    /// carry**, and until `deep_nearby_minibrots_ckpt138` there was no way out at
    /// all: [`Fx::parse`] read a centre in and [`Fx::to_f64`] was the only way
    /// back, which keeps two limbs and so throws away every digit that says where
    /// a deep view is. A nucleus solved at 1e-44 that could only leave as a double
    /// would be a tile nobody could open.
    ///
    /// **Exact at the full length.** A fraction of `64(n-1)` bits is a decimal of
    /// exactly `64(n-1)` digits — `2^-k` is `5^k/10^k` — so `to_decimal(64 * (n -
    /// 1))` loses nothing and `Fx::parse` reads it back as the same number. Below
    /// that it truncates toward zero, the direction [`Fx::mul`] truncates in, so a
    /// caller spending guard digits knows the place it names is inside the place
    /// it computed.
    ///
    /// **No `u128` and no division**, which are this file's own rules. The
    /// fraction is multiplied by ten a digit at a time through `u32` halves, and
    /// the carry out of the top fraction limb *is* the next digit — at most nine,
    /// because ten times a number below one is below ten.
    pub fn to_decimal(&self, places: usize) -> String {
        let (neg, m) = self.abs();
        let n = m.n;
        let mut out = String::with_capacity(places + 24);
        if neg {
            out.push('-');
        }
        // The integer limb is the integer part: after `abs` it is non-negative,
        // and nothing an `i64` cannot hold gets in through `parse` or `from_f64`.
        out.push_str(&m.w[n - 1].to_string());
        if places == 0 {
            return out;
        }
        out.push('.');

        let mut frac = [0u64; MAX_LIMBS];
        frac[..n - 1].copy_from_slice(&m.w[..n - 1]);
        for _ in 0..places {
            let mut carry = 0u64;
            for limb in frac.iter_mut().take(n - 1) {
                // Ten times a limb, through halves. Every term fits: the carry in
                // is at most nine, so `(2^32 - 1) * 10 + 9` is under `2^36`.
                let low = (*limb & 0xffff_ffff) * 10 + carry;
                let high = (*limb >> 32) * 10 + (low >> 32);
                *limb = (low & 0xffff_ffff) | (high << 32);
                carry = high >> 32;
            }
            out.push((b'0' + carry as u8) as char);
        }
        out
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

/// The low half of a `u64`.
const LOW: u64 = 0xffff_ffff;

/// The magnitude of an `N`-limb number, and whether it was negative.
///
/// The negation is the two's complement [`Fx::neg`] takes, done branch-free.
#[inline(always)]
fn magnitude<const N: usize>(w: &[u64]) -> (bool, [u64; N]) {
    let w = &w[..N];
    let neg = (w[N - 1] as i64) < 0;
    (neg, signed(w.try_into().unwrap(), neg))
}

/// `window`, negated in two's complement where `negative` says so.
#[inline(always)]
fn signed<const N: usize>(window: &[u64; N], negative: bool) -> [u64; N] {
    let flip = if negative { u64::MAX } else { 0 };
    let mut carry = negative as u64;
    let mut out = [0u64; N];
    for k in 0..N {
        let (limb, c) = (window[k] ^ flip).overflowing_add(carry);
        carry = c as u64;
        out[k] = limb;
    }
    out
}

/// The kept window of a product of magnitudes, as a signed [`Fx`].
#[inline(always)]
fn finish<const N: usize>(window: &[u64; N], negative: bool) -> Fx {
    let mut r = Fx::zero(N);
    r.w[..N].copy_from_slice(&signed(window, negative));
    r
}

/// A fixed-point real at a limb count the compiler knows: [`Fx`]'s limbs and
/// nothing else, for the reference orbit's loop.
///
/// **The same number and the same arithmetic as [`Fx`], bit for bit**, and only
/// a different shape: every trip count is a constant, nothing is zeroed past the
/// `N` limbs in use, and a multiply's operands are made magnitudes once where the
/// orbit uses them more than once. [`Fx`] stays what everything else in the crate
/// computes with; `tests/orbit_parity.rs` holds the orbit to it.
///
/// Its operations are out of line, one copy a limb count: inlined into every
/// call site they timed the same in the orbit and cost tens of kilobytes of
/// module.
#[derive(Clone, Copy)]
pub struct Limbs<const N: usize>(pub [u64; N]);

/// A [`Limbs`] ready to multiply: its sign, and its magnitude.
#[derive(Clone, Copy)]
pub struct Split<const N: usize> {
    negative: bool,
    magnitude: [u64; N],
}

impl<const N: usize> Limbs<N> {
    pub const ZERO: Self = Limbs([0; N]);

    pub fn of(x: &Fx) -> Self {
        let mut w = [0u64; N];
        w.copy_from_slice(&x.w[..N]);
        Limbs(w)
    }

    /// [`Fx::add`]: the sum modulo `2^(64N)`.
    #[inline(never)]
    pub fn add(&self, b: &Self) -> Self {
        let mut r = [0u64; N];
        let mut carry = false;
        for i in 0..N {
            let (s1, c1) = self.0[i].overflowing_add(b.0[i]);
            let (s2, c2) = s1.overflowing_add(carry as u64);
            r[i] = s2;
            carry = c1 | c2;
        }
        Limbs(r)
    }

    /// [`Fx::sub`], which is `self + (−b)` modulo `2^(64N)` and so is the
    /// difference modulo the same, taken in one borrowing pass.
    #[inline(never)]
    pub fn sub(&self, b: &Self) -> Self {
        let mut r = [0u64; N];
        let mut borrow = false;
        for i in 0..N {
            let (s1, b1) = self.0[i].overflowing_sub(b.0[i]);
            let (s2, b2) = s1.overflowing_sub(borrow as u64);
            r[i] = s2;
            borrow = b1 | b2;
        }
        Limbs(r)
    }

    /// [`Fx::shl1`].
    #[inline(never)]
    pub fn shl1(&self) -> Self {
        let mut r = [0u64; N];
        let mut carry = 0u64;
        for i in 0..N {
            r[i] = (self.0[i] << 1) | carry;
            carry = self.0[i] >> 63;
        }
        Limbs(r)
    }

    /// [`Fx::to_f64`], step for step: the same two limbs, summed in the same
    /// order.
    #[inline(never)]
    pub fn to_f64(&self) -> f64 {
        let neg = (self.0[N - 1] as i64) < 0;
        let m = signed(&self.0, neg);
        let mut v = 0.0f64;
        let mut taken = 0;
        for i in (0..N).rev() {
            if taken == 0 && m[i] == 0 {
                continue;
            }
            v += m[i] as f64 * pow2(64 * (i as i32 - (N as i32 - 1)));
            taken += 1;
            if taken == 2 {
                break;
            }
        }
        if neg { -v } else { v }
    }

    /// The sign and magnitude a multiply reads.
    #[inline(never)]
    pub fn split(&self) -> Split<N> {
        let (negative, magnitude) = magnitude::<N>(&self.0);
        Split {
            negative,
            magnitude,
        }
    }
}

/// [`Fx::mul`] of two split numbers.
#[inline(never)]
pub fn mul_split<const N: usize>(a: &Split<N>, b: &Split<N>) -> Limbs<N> {
    let window = product::<N, false>(&a.magnitude, &b.magnitude);
    Limbs(signed(&window, a.negative ^ b.negative))
}

/// [`Fx::sqr`] of a split number.
#[inline(never)]
pub fn sqr_split<const N: usize>(a: &Split<N>) -> Limbs<N> {
    Limbs(product::<N, true>(&a.magnitude, &a.magnitude))
}

/// The window of the exact product of two magnitudes, truncated toward zero:
/// bits `64(N−1) .. 64(2N−1)` of the `2N`-limb product, which is what [`Fx::mul`]
/// has always returned before its sign.
///
/// Up to [`STRAIGHT`] limbs by [`straight`]'s unrolled code, and past it by
/// [`columns`]' loop; both sum only the columns that can reach the window, and
/// both fall back to [`exact`] where that cannot be vouched for. The answer is the
/// exact product's window every time.
#[inline(always)]
fn product<const N: usize, const SQUARE: bool>(a: &[u64; N], b: &[u64; N]) -> [u64; N] {
    if N <= STRAIGHT {
        let (window, unsure) = straight::<N, SQUARE>(a, b);
        if unsure { exact::<N>(a, b) } else { window }
    } else {
        // Past `STRAIGHT`, `N − 3 ≥ 8`: see `columns` for why the carry the
        // skipped columns could bring is under `g·2^64`.
        let g = N - 3;
        let (window, below) = columns::<N, SQUARE>(&pairs(a), &pairs(b), g);
        if below <= u64::MAX - g as u64 {
            window
        } else {
            exact::<N>(a, b)
        }
    }
}

/// The whole product, for the rare window [`product`] cannot vouch for.
#[inline(always)]
fn exact<const N: usize>(a: &[u64; N], b: &[u64; N]) -> [u64; N] {
    let mut window = [0u64; N];
    whole(a, b, &mut window);
    window
}

/// The window of the exact product of two magnitudes of the same length,
/// schoolbook over every half-limb: the multiply as it was written before any of
/// this, kept for the products the faster ones cannot vouch for. Out of line and
/// unspecialized, because it is almost never run.
#[inline(never)]
#[cold]
fn whole(a: &[u64], b: &[u64], window: &mut [u64]) {
    #[cfg(test)]
    tests::FALLBACKS.fetch_add(1, core::sync::atomic::Ordering::Relaxed);
    let n = a.len();
    let halves = 2 * n;
    let half = |w: &[u64], i: usize| (w[i >> 1] >> (32 * (i & 1))) & LOW;
    let mut p = [0u32; 4 * MAX_LIMBS];
    for i in 0..halves {
        let ai = half(a, i);
        let mut carry = 0u64;
        for j in 0..halves {
            // Every term fits: (2^32−1)² + 2·(2^32−1) is exactly 2^64−1.
            let t = ai * half(b, j) + (p[i + j] as u64) + carry;
            p[i + j] = t as u32;
            carry = t >> 32;
        }
        p[i + halves] = carry as u32;
    }
    for (k, limb) in window.iter_mut().enumerate() {
        let src = 2 * (n - 1 + k);
        *limb = (p[src] as u64) | ((p[src + 1] as u64) << 32);
    }
}

/// A magnitude as half-limb pairs, low half first, each in a `u64` so that a
/// partial product is one multiply.
#[inline(always)]
fn pairs<const N: usize>(w: &[u64; N]) -> [[u64; 2]; N] {
    let mut out = [[0u64; 2]; N];
    for (pair, &limb) in out.iter_mut().zip(w) {
        *pair = [limb & LOW, limb >> 32];
    }
    out
}

/// The four half-limb products of one limb pair, summed into the four half-limb
/// columns they land in.
#[inline(always)]
fn pair(s: &mut [u64; 4], &[a0, a1]: &[u64; 2], &[b0, b1]: &[u64; 2]) {
    let (p00, p01, p10, p11) = (a0 * b0, a0 * b1, a1 * b0, a1 * b1);
    s[0] += p00 & LOW;
    s[1] += (p00 >> 32) + (p01 & LOW) + (p10 & LOW);
    s[2] += (p01 >> 32) + (p10 >> 32) + (p11 & LOW);
    s[3] += p11 >> 32;
}

/// Limb columns `from..` of the product of two magnitudes held as half-limb
/// pairs, summed column by column (Comba): the `N`-limb window a product keeps,
/// which is limb columns `N−1 ..= 2N−2`, and limb column `N−2` just below it.
///
/// The multiply past [`STRAIGHT`] limbs, and every limb count's [`exact`] one.
/// **A column is a limb column, and a limb pair is four half-limb products**
/// `a₀b₀ + (a₀b₁ + a₁b₀)·B + a₁b₁·B²`, `B = 2^32`, which land in the four
/// half-limb columns `2k ..= 2k+3`. Each product is summed as its two halves, so
/// nothing carries inside a column: a column has at most `N ≤ 16` pairs, and its
/// sums stay under `2^40`. The two upper half-columns are handed on to the next
/// limb column, which is where they belong.
///
/// **Columns below `g` are not summed when `from = g`, and the caller checks for
/// the one case that could matter.** A limb column `k` is at most `k + 1` pairs
/// of `(2^64−1)²`, so everything below column `g` adds `L < g·(2^64−1)·2^(64g)`
/// to the product, and the carry it would have brought into column `g` is under
/// `g·2^64`. The window starts two limb columns above `g`, so that carry reaches
/// it only by overflowing the 128 bits columns `g` and `g+1` hold — which it
/// cannot while column `g+1`, the `u64` returned beside the window, is at most
/// `2^64 − 1 − g`.
///
/// With `SQUARE` the operands are the same number and each cross pair `i < j` is
/// formed once and doubled, as is the cross half `a₀a₁` of a diagonal pair — the
/// column's sum, and so the product, is the same integer.
#[inline(always)]
fn columns<const N: usize, const SQUARE: bool>(
    a: &[[u64; 2]; N],
    b: &[[u64; 2]; N],
    from: usize,
) -> ([u64; N], u64) {
    let mut window = [0u64; N];
    let mut below = 0u64;
    // The carry out of the last half-column finished, and the two half-columns
    // the previous limb column reached into this one with.
    let (mut carry, mut next0, mut next1) = (0u64, 0u64, 0u64);
    for k in from..2 * N - 1 {
        // The pairs `(i, k − i)` with both inside the number.
        let first = (k + 1).saturating_sub(N);
        let end = if k < N { k + 1 } else { N };
        let mut s = [0u64; 4];
        if SQUARE {
            // `i < k − i`: each unordered pair once, then doubled.
            let half = k.div_ceil(2);
            for (x, y) in a[first..half]
                .iter()
                .zip(a[k + 1 - half..=k - first].iter().rev())
            {
                pair(&mut s, x, y);
            }
            let diagonal = &a[k / 2];
            if k % 2 == 0 {
                let p01 = diagonal[0] * diagonal[1];
                s[1] += p01 & LOW;
                s[2] += p01 >> 32;
            }
            for column in s.iter_mut() {
                *column <<= 1;
            }
            if k % 2 == 0 {
                let (p00, p11) = (diagonal[0] * diagonal[0], diagonal[1] * diagonal[1]);
                s[0] += p00 & LOW;
                s[1] += p00 >> 32;
                s[2] += p11 & LOW;
                s[3] += p11 >> 32;
            }
        } else {
            for (x, y) in a[first..end]
                .iter()
                .zip(b[k + 1 - end..=k - first].iter().rev())
            {
                pair(&mut s, x, y);
            }
        }
        let t0 = s[0] + next0 + carry;
        let t1 = s[1] + next1 + (t0 >> 32);
        carry = t1 >> 32;
        (next0, next1) = (s[2], s[3]);
        let limb = (t0 & LOW) | (t1 << 32);
        if k + 1 >= N {
            window[k + 1 - N] = limb;
        } else if k + 2 == N {
            below = limb;
        }
    }
    (window, below)
}

// ------------------------------------------------------- the unrolled products

/// The widest limb count [`product`] multiplies by unrolled code. Past it the
/// loop in [`columns`] does, which is a little over twice as slow and a fraction
/// of the module: each unrolled width costs kilobytes, and the widths past this
/// are the deepest frames there are.
pub const STRAIGHT: usize = 10;

/// Bits in a digit of the unrolled product.
///
/// **Twenty-nine, so that a column never needs splitting.** A product of two
/// digits is under `2^58`, and a column of the widest number this module forms —
/// sixteen limbs, 36 digits — sums at most 36 of them, under `2^63.2`, with room
/// for the carry in. So a column is one running `u64` sum, one multiply and one
/// add a product, where a 32-bit half-limb needs every product split in two to be
/// summed safely; that is worth more than the 27% more products the narrower
/// digit costs.
const DIGIT: usize = 29;
const DIGIT_MASK: u64 = (1 << DIGIT) - 1;

/// Bits kept between the lowest column summed and the window.
///
/// The columns below are skipped on a carry bound of `g · 2^29 < 2^36` (see
/// [`straight`]), so a guard of 100 bits leaves 64 that must all be set before
/// the skipped carry could reach the window.
const GUARD: usize = 100;

/// The first digit column [`straight`] sums at `n` limbs.
pub const fn skipped_columns(n: usize) -> usize {
    let window = 64 * (n - 1);
    if window > GUARD {
        (window - GUARD) / DIGIT
    } else {
        0
    }
}

/// Room for any digit or column index the unrolling below can name.
const SPAN: usize = 2 * 36 + 4;

/// The digits of a magnitude, unrolled over a literal list of digit indices.
macro_rules! digits {
    ($w:ident, $n:expr, [$($t:literal)*]) => {{
        let mut out = [0u64; SPAN];
        $({
            let (q, r) = ((DIGIT * $t) / 64, (DIGIT * $t) % 64);
            let mut v = $w[q.min($n - 1)] >> r;
            if r > 64 - DIGIT && q + 1 < $n {
                v |= $w[(q + 1).min($n - 1)] << ((64 - r) & 63);
            }
            out[$t] = v & DIGIT_MASK;
        })*
        out
    }};
}

/// One row of a product's digit grid: `a_i · b_j` into column `i + j`, for every
/// column the product sums. Every condition is on literals and folds away.
macro_rules! row {
    ($col:ident, $a:ident, $b:ident, $g:expr, $top:expr, $i:literal, [$($j:literal)*]) => {
        $(
            if $i + $j >= $g && $i + $j <= $top {
                $col[$i + $j] += $a[$i] * $b[$j];
            }
        )*
    };
}

macro_rules! grid {
    ($col:ident, $a:ident, $b:ident, $g:expr, $top:expr, [$($i:literal)*], $js:tt) => {
        $( row!($col, $a, $b, $g, $top, $i, $js); )*
    };
}

/// A square's row: each cross term `i < j` once, and the diagonal.
macro_rules! square_row {
    ($cross:ident, $diag:ident, $a:ident, $g:expr, $top:expr, $i:literal, [$($j:literal)*]) => {
        $(
            if $i < $j && $i + $j >= $g && $i + $j <= $top {
                $cross[$i + $j] += $a[$i] * $a[$j];
            }
            if $i == $j && $i + $j >= $g && $i + $j <= $top {
                $diag[$i + $j] = $a[$i] * $a[$i];
            }
        )*
    };
}

macro_rules! square_grid {
    ($cross:ident, $diag:ident, $a:ident, $g:expr, $top:expr, [$($i:literal)*], $js:tt) => {
        $( square_row!($cross, $diag, $a, $g, $top, $i, $js); )*
    };
}

macro_rules! doubled {
    ($col:ident, $cross:ident, $diag:ident, [$($k:literal)*]) => {
        $( $col[$k] = ($cross[$k] << 1) + $diag[$k]; )*
    };
}

/// Carry the column sums into digits and lay the window's bits into limbs, and
/// say whether the skipped columns' carry could have reached it: whether every
/// bit from 36 above the lowest summed column up to the window is set.
macro_rules! window {
    ($col:ident, $n:expr, $g:expr, $top:expr, [$($k:literal)*]) => {{
        let start = 64 * ($n - 1);
        let (lo, hi) = (DIGIT * $g + 36, start);
        let mut out = [0u64; $n];
        let mut carry = 0u64;
        let mut unsure = $g > 0;
        $(
            if $k >= $g {
                let t = $col[$k] + carry;
                let e = t & DIGIT_MASK;
                carry = t >> DIGIT;
                let p = DIGIT * $k;
                if p + DIGIT > start {
                    if p >= start {
                        let (l, s) = (((p - start) / 64).min($n - 1), (p - start) % 64);
                        out[l] |= e << s;
                        if s > 64 - DIGIT && l + 1 < $n {
                            out[(l + 1).min($n - 1)] |= e >> ((64 - s) & 63);
                        }
                    } else {
                        out[0] |= e >> ((start - p) & 63);
                    }
                }
                let (x, y) = (p.max(lo), (p + DIGIT).min(hi));
                if x < y {
                    let mask = ((1u64 << ((y - x) & 63)) - 1) << ((x - p) & 63);
                    unsure &= e & mask == mask;
                }
            }
        )*
        let _ = carry;
        (out, unsure)
    }};
}

/// The product of two magnitudes at one limb count, unrolled: digits in, the
/// window out, and whether [`exact`] must be asked instead. `$digits` lists the
/// digit indices `0..D`, `D = ⌈64N/29⌉`, and `$columns` the columns up to the
/// last one with a bit in the window, `⌊(64(2N−1) − 1)/29⌋`.
macro_rules! straight_at {
    ($mul:ident, $sqr:ident, $n:literal: $digits:tt $columns:tt) => {
        // A literal column `0 >= G` is a comparison the lint calls useless; it is
        // the same condition as every other column's.
        #[allow(unused_comparisons)]
        #[inline(never)]
        fn $mul(a: &[u64; $n], b: &[u64; $n]) -> ([u64; $n], bool) {
            const G: usize = skipped_columns($n);
            const TOP: usize = (64 * (2 * $n - 1) - 1) / DIGIT;
            let a = digits!(a, $n, $digits);
            let b = digits!(b, $n, $digits);
            let mut col = [0u64; 2 * SPAN];
            grid!(col, a, b, G, TOP, $digits, $digits);
            window!(col, $n, G, TOP, $columns)
        }

        #[allow(unused_comparisons)]
        #[inline(never)]
        fn $sqr(a: &[u64; $n]) -> ([u64; $n], bool) {
            const G: usize = skipped_columns($n);
            const TOP: usize = (64 * (2 * $n - 1) - 1) / DIGIT;
            let a = digits!(a, $n, $digits);
            let (mut cross, mut diag) = ([0u64; 2 * SPAN], [0u64; 2 * SPAN]);
            square_grid!(cross, diag, a, G, TOP, $digits, $digits);
            let mut col = [0u64; 2 * SPAN];
            doubled!(col, cross, diag, $columns);
            window!(col, $n, G, TOP, $columns)
        }
    };
}

straight_at!(mul_2, sqr_2, 2: [0 1 2 3 4] [0 1 2 3 4 5 6]);
straight_at!(mul_3, sqr_3, 3: [0 1 2 3 4 5 6] [0 1 2 3 4 5 6 7 8 9 10 11]);
straight_at!(mul_4, sqr_4, 4: [0 1 2 3 4 5 6 7 8] [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15]);
straight_at!(mul_5, sqr_5, 5: [0 1 2 3 4 5 6 7 8 9 10 11]
    [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19]);
straight_at!(mul_6, sqr_6, 6: [0 1 2 3 4 5 6 7 8 9 10 11 12 13]
    [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24]);
straight_at!(mul_7, sqr_7, 7: [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15]
    [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28]);
straight_at!(mul_8, sqr_8, 8: [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17]
    [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32
     33]);
straight_at!(mul_9, sqr_9, 9: [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19]
    [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32
     33 34 35 36 37]);
straight_at!(mul_10, sqr_10, 10: [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22]
    [0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32
     33 34 35 36 37 38 39 40 41]);

/// The unrolled product at `N` limbs, `N ≤ STRAIGHT`: the window, and whether
/// the skipped columns could have reached it. Every arm but `N`'s folds away, and
/// in `N`'s the conversions cannot fail.
#[inline(always)]
fn straight<const N: usize, const SQUARE: bool>(a: &[u64; N], b: &[u64; N]) -> ([u64; N], bool) {
    macro_rules! at {
        ($($n:literal => $mul:ident $sqr:ident,)*) => {
            match N {
                $($n => {
                    let a: &[u64; $n] = a.as_slice().try_into().unwrap();
                    let b: &[u64; $n] = b.as_slice().try_into().unwrap();
                    let (window, unsure) = if SQUARE { $sqr(a) } else { $mul(a, b) };
                    (window.as_slice().try_into().unwrap(), unsure)
                })*
                _ => unreachable!(),
            }
        };
    }
    at! {
        2 => mul_2 sqr_2, 3 => mul_3 sqr_3, 4 => mul_4 sqr_4, 5 => mul_5 sqr_5,
        6 => mul_6 sqr_6, 7 => mul_7 sqr_7, 8 => mul_8 sqr_8, 9 => mul_9 sqr_9,
        10 => mul_10 sqr_10,
    }
}

/// `2^k`, without `powi`'s loop and without libm.
///
/// Public since `deep_nearby_minibrots_ckpt138`, which carries a nucleus's
/// derivative as a mantissa and a power-of-two exponent — the interior switch's
/// representation — and needs the exponent spent when the two are divided.
pub fn pow2(k: i32) -> f64 {
    // `k` is a multiple of 64. Within this file it is between −960 and 0 and
    // sub-normal territory is unreachable; `crate::nuclei` reaches further in
    // both directions, and the halving below is what keeps the function total.
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

    /// [`Fx::mul`] as it was written until `deep_refactor_ckpt138`: one
    /// unspecialized loop over a scratch array of the widest number this module
    /// carries. Kept here and nowhere else, as the thing the dispatch is held
    /// to.
    fn mul_unspecialized(a0: &Fx, b0: &Fx) -> Fx {
        let n = a0.n;
        let (sa, a) = a0.abs();
        let (sb, b) = b0.abs();
        let halves = 2 * n;
        let mut p = [0u32; 4 * MAX_LIMBS];
        for i in 0..halves {
            let ai = half(&a.w, i) as u64;
            if ai == 0 {
                continue;
            }
            let mut carry = 0u64;
            for j in 0..halves {
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

    /// **Every bit of every product, at every limb count.**
    ///
    /// The dispatch in [`Fx::mul`] is fifteen arms of `N` and `P` written out by
    /// hand, and an arm pointing at the wrong specialization is a multiply that
    /// answers plausibly and wrongly — the pins that would catch it are all
    /// downstream, a smooth value or a picture or a link. This is the one that
    /// catches it here: a deterministic spread of operands of both signs, with
    /// zero limbs among them, held to the unspecialized version limb for limb.
    #[test]
    fn the_product_is_the_same_at_every_limb_count() {
        // A 64-bit LCG, written out rather than depended on.
        let mut state = 0x2545_f491_4f6c_dd1du64;
        let mut next = || {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            state
        };
        for n in 2..=MAX_LIMBS {
            for case in 0..200 {
                let mut make = || {
                    let mut value = Fx::zero(n);
                    for limb in value.w.iter_mut().take(n) {
                        *limb = next();
                    }
                    // The integer limb stays small: these are the coordinates
                    // and deltas of a frame, never numbers with a large whole
                    // part, and `mul` truncates rather than reporting overflow.
                    value.w[n - 1] &= 0x3;
                    if case % 3 == 0 {
                        value = value.neg();
                    }
                    if case % 7 == 0 {
                        // A limb of zeros, which is the row the loop skips.
                        value.w[case % n] = 0;
                    }
                    value
                };
                let (a, b) = (make(), make());
                let wanted = mul_unspecialized(&a, &b);
                let got = a.mul(&b);
                assert_eq!(got.n, wanted.n);
                assert_eq!(
                    got.w[..n],
                    wanted.w[..n],
                    "n = {n}, case {case}: {:?} × {:?}",
                    &a.w[..n],
                    &b.w[..n]
                );
            }
        }
    }

    /// Operands chosen to be hard on a product summed column by column: every
    /// half-limb at its largest, every one at zero, alternating, single bits,
    /// and both signs of each — the column sums at their maximum are where a
    /// carry or the truncation bound would be wrong first.
    fn awkward(n: usize) -> Vec<Fx> {
        let mut out = Vec::new();
        let patterns: [u64; 6] = [
            u64::MAX,
            0,
            0xaaaa_aaaa_aaaa_aaaa,
            0xffff_ffff_0000_0000,
            0x0000_0000_ffff_ffff,
            0x8000_0000_0000_0001,
        ];
        for &fraction in &patterns {
            for integer in [0u64, 1, 3] {
                let mut value = Fx::zero(n);
                for limb in value.w.iter_mut().take(n - 1) {
                    *limb = fraction;
                }
                value.w[n - 1] = integer;
                out.push(value);
                out.push(value.neg());
            }
        }
        out
    }

    /// **The square is the product of the number with itself, bit for bit**, and
    /// so is every product of the awkward operands — which is what the column
    /// sums and the truncated window have to be held to.
    #[test]
    fn the_square_and_the_awkward_products_are_the_unspecialized_product() {
        let mut state = 0x9e37_79b9_7f4a_7c15u64;
        let mut next = || {
            state = state
                .wrapping_mul(6364136223846793005)
                .wrapping_add(1442695040888963407);
            state
        };
        for n in 2..=MAX_LIMBS {
            for case in 0..2000 {
                let mut value = Fx::zero(n);
                for limb in value.w.iter_mut().take(n) {
                    *limb = next();
                }
                value.w[n - 1] &= 0xff;
                if case % 2 == 0 {
                    value = value.neg();
                }
                let wanted = mul_unspecialized(&value, &value);
                assert_eq!(value.sqr().w[..n], wanted.w[..n], "n = {n}, case {case}");
            }
            let awkward = awkward(n);
            for a in &awkward {
                assert_eq!(a.sqr().w[..n], mul_unspecialized(a, a).w[..n], "n = {n}");
                for b in &awkward {
                    assert_eq!(a.mul(b).w[..n], mul_unspecialized(a, b).w[..n], "n = {n}");
                }
            }
        }
    }

    /// **The bound the truncated product stands on, measured where it is
    /// tightest.** Limb columns below `g = n − 3` are skipped on the promise that
    /// what they sum to, carried into column `g`, is under `g · 2^64`. With every
    /// bit of both operands set the skipped pairs are as large as they can be, so
    /// their sum is formed here exactly, in `u32` digits, and held to the promise
    /// rather than trusted.
    #[test]
    fn the_skipped_columns_carry_less_than_the_bound() {
        for n in 4..=MAX_LIMBS {
            let g = n - 3;
            let mut digits = [0u64; 4 * MAX_LIMBS + 2];
            let mut add_at = |at: usize, value: u64| {
                let mut carry = value;
                let mut k = at;
                while carry != 0 {
                    let t = digits[k] + (carry & LOW);
                    digits[k] = t & LOW;
                    carry = (carry >> 32) + (t >> 32);
                    k += 1;
                }
            };
            for i in 0..n {
                for j in 0..n {
                    if i + j >= g {
                        continue;
                    }
                    // `(2^64 − 1)²`, as its four half-limb products.
                    let at = 2 * (i + j);
                    add_at(at, LOW * LOW);
                    add_at(at + 1, LOW * LOW);
                    add_at(at + 1, LOW * LOW);
                    add_at(at + 2, LOW * LOW);
                }
            }
            // The carry into limb column `g` is the sum from half-limb `2g` up.
            assert!(digits[2 * g + 4..].iter().all(|&d| d == 0), "n = {n}");
            let top = digits[2 * g + 2] | (digits[2 * g + 3] << 32);
            assert!(top < g as u64, "n = {n}: carry reaches {top:#x}·2^64");
        }
    }

    /// **The same promise, for the unrolled product's 29-bit columns**: what the
    /// columns below [`skipped_columns`] sum to, carried into the first column
    /// summed, is under `2^36` — the bound [`GUARD`] leaves 64 bits above. Formed
    /// exactly with every digit at its largest.
    #[test]
    fn the_skipped_digit_columns_carry_less_than_two_to_the_36() {
        for n in 2..=STRAIGHT {
            let g = skipped_columns(n);
            let d = (64 * n).div_ceil(DIGIT);
            // Column sums of the skipped grid, then carried in base 2^29.
            let mut columns = [0u64; 2 * SPAN];
            for i in 0..d {
                for j in 0..d {
                    if i + j < g {
                        columns[i + j] += DIGIT_MASK * DIGIT_MASK;
                    }
                }
            }
            let mut carry = 0u64;
            for column in columns.iter_mut() {
                let t = *column + carry;
                *column = t & DIGIT_MASK;
                carry = t >> DIGIT;
            }
            assert_eq!(carry, 0);
            // Everything from column `g` up is the carry; it has to fit in 36 bits.
            assert!(columns[g + 2..].iter().all(|&e| e == 0), "n = {n}");
            assert!(columns[g + 1] < 1 << (36 - DIGIT), "n = {n}");
            // And the guard leaves at least 64 bits of it to check.
            assert!(g == 0 || 64 * (n - 1) - DIGIT * g >= 36 + 64, "n = {n}");
        }
    }

    /// How many products [`product`] has handed to [`exact`], so that the test
    /// below can say the rare path ran rather than assume it.
    pub(super) static FALLBACKS: core::sync::atomic::AtomicUsize =
        core::sync::atomic::AtomicUsize::new(0);

    /// **The rare path runs, and agrees.** A number just under one with every
    /// fraction bit set squares to a product whose guard columns are all ones —
    /// `(1 − ε)² = 1 − 2ε + ε²`, and the borrow of `−2ε` runs through every
    /// column below the window — so the truncated sum cannot vouch for itself and
    /// the product is summed again from column zero.
    #[test]
    fn a_product_the_truncation_cannot_vouch_for_is_summed_whole() {
        use core::sync::atomic::Ordering;
        // Below four limbs nothing is skipped and there is nothing to vouch for.
        for n in 4..=MAX_LIMBS {
            let before = FALLBACKS.load(Ordering::Relaxed);
            let mut hits = 0;
            for fraction in [u64::MAX, u64::MAX - 1, u64::MAX >> 1] {
                let mut value = Fx::zero(n);
                for limb in value.w.iter_mut().take(n - 1) {
                    *limb = fraction;
                }
                for operand in [value, value.neg()] {
                    let wanted = mul_unspecialized(&operand, &operand);
                    assert_eq!(operand.sqr().w[..n], wanted.w[..n], "n = {n}");
                    assert_eq!(operand.mul(&operand).w[..n], wanted.w[..n], "n = {n}");
                    hits += 1;
                }
            }
            assert!(hits > 0);
            // Other tests run beside this one and may add to the count too; the
            // claim is only that it moved.
            assert!(
                FALLBACKS.load(Ordering::Relaxed) > before,
                "n = {n}: never fell back"
            );
        }
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
        let narrowed =
            -0.74501772828532335842941892835857434f64 - -0.74501772828532335842941892835857400f64;
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

    /// **The way out, held to being the inverse of the way in.** At the full
    /// length a fixed-point fraction *is* a terminating decimal, so this is an
    /// exact round trip rather than a close one.
    #[test]
    fn a_decimal_comes_back_out_exactly_at_the_full_length() {
        for text in [
            "0",
            "1.5",
            "-2.25",
            "-0.74501772828532335842941892835857434",
            "0.14993443275456819177805709088257971",
        ] {
            let value = Fx::parse(text, 4).unwrap();
            // 64 fraction bits a limb is 64 decimal digits a limb, exactly.
            let full = value.to_decimal(64 * 3);
            let back = Fx::parse(&full, 4).unwrap();
            assert!(
                back.sub(&value).to_f64() == 0.0,
                "{text} went out as {full} and came back different"
            );
        }
    }

    /// Truncation is toward zero on both signs, which is what a caller spending
    /// guard digits relies on: the place named is inside the place computed.
    #[test]
    fn to_decimal_truncates_toward_zero_and_never_rounds_away() {
        let positive = Fx::parse("0.19999999999999999999", 4).unwrap();
        assert_eq!(positive.to_decimal(1), "0.1");
        let negative = Fx::parse("-0.19999999999999999999", 4).unwrap();
        assert_eq!(negative.to_decimal(1), "-0.1");
        assert_eq!(Fx::parse("-2.75", 4).unwrap().to_decimal(0), "-2");
        assert_eq!(Fx::parse("1.5", 4).unwrap().to_decimal(4), "1.5000");
    }

    /// A place below the `f64` floor survives the round trip, which is the whole
    /// reason this exists — and the double cannot tell it from a frame four
    /// decades up, which is the reason it had to.
    ///
    /// **It is a round trip and not a string comparison, because a decimal is
    /// not generally a binary fraction.** `tests/descend.rs` builds a centre out
    /// of terms like `(2·col − 63)·5⁷·10^−(7+p)`, which carries a `5^−p` and so
    /// is not dyadic: `parse` lands just inside it and the digits that come back
    /// are the digits of what is *stored*. Nothing is lost by that — the gap is
    /// below the last limb — but the assertion has to be made against the value.
    #[test]
    fn a_place_below_the_f64_floor_survives_the_round_trip() {
        let deep = "-0.7450177282901986192987792989188510315333046875";
        let value = Fx::parse(deep, 6).unwrap();
        let back = Fx::parse(&value.to_decimal(64 * 5), 6).unwrap();
        assert!(back.sub(&value).to_f64() == 0.0);
        // Forty-six digits is enough to place a pixel of a 1e-40 frame, and what
        // comes out at that length is within an ulp of the centre that went in.
        let trimmed = Fx::parse(&value.to_decimal(46), 6).unwrap();
        assert!(trimmed.sub(&value).to_f64().abs() < 1e-45);
        // And the double cannot tell this place from a frame seventeen digits up.
        assert_eq!(
            value.to_f64(),
            Fx::parse("-0.74501772829019861929877929891", 6)
                .unwrap()
                .to_f64()
        );
    }

    /// An `f64` **is** a binary fraction, so its exact decimal is finite and
    /// this is the one case where the string can be asserted outright. A famous
    /// one, so that a reader can check it against something other than this
    /// file: the double nearest a tenth, all fifty-five digits of it.
    #[test]
    fn the_exact_decimal_of_a_double_comes_out_whole() {
        let tenth = Fx::from_f64(0.1, 6).unwrap();
        assert_eq!(
            tenth.to_decimal(55),
            "0.1000000000000000055511151231257827021181583404541015625"
        );
        // One digit short of the end is the same number with its tail cut off,
        // never a rounded last place.
        assert_eq!(
            tenth.to_decimal(54),
            "0.100000000000000005551115123125782702118158340454101562"
        );
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
