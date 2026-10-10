//! The WGSL builtins the per-pixel model uses, written out so that the shader port is
//! one line for one line.
//!
//! Every function here takes and returns `f32`, `i32` or `u32` only. Where WGSL's own
//! builtin is not reliable enough to lean on, the function says so and does the work
//! with bit operations instead, which WGSL expresses exactly with `bitcast`.
//!
//! **Subnormals are treated as zero, on purpose.** WGSL lets an implementation flush
//! subnormal values, and GPUs differ, so nothing here produces one: [`ldexp_exact`]
//! truncates to a signed zero where the result would be subnormal, and [`exponent_of`]
//! reports a subnormal input as zero. The arithmetic operators themselves can still
//! produce a subnormal on the CPU, but only in a component that is at least `2^26` below
//! the larger component of the same value, or in a term that is that far below the term
//! it is added to: `model.rs`'s quick path runs only where its operands keep every
//! leading term at or above `2^-100`, and its careful path works in units where the
//! larger operand is about 1. So a GPU that flushes changes nothing above the rounding.

/// The exponent field of an `f32`, as `bitcast<u32>(x)` reads it.
const EXPONENT_MASK: u32 = 0x7f80_0000;
/// Sign and mantissa: everything but the exponent field.
const KEEP_MASK: u32 = 0x807f_ffff;

/// `bitcast<u32>(x)`.
#[inline(always)]
pub fn bits(x: f32) -> u32 {
    x.to_bits()
}

/// `bitcast<f32>(b)`.
#[inline(always)]
pub fn from_bits(b: u32) -> f32 {
    f32::from_bits(b)
}

/// The unbiased binary exponent of `|x|`, so that `|x|` lies in `[2^e, 2^(e+1))`, for a
/// normal `x`. Zero and subnormals give `-127`, which no normal value has; infinity and
/// NaN give `128`. WGSL: `i32((bitcast<u32>(x) >> 23u) & 0xffu) - 127`. This is the
/// exponent half of WGSL's `frexp`, which is not used because its result is a struct
/// whose exponent is offset by one and whose subnormal handling is the implementation's.
#[inline(always)]
pub fn exponent_of(x: f32) -> i32 {
    ((bits(x) & EXPONENT_MASK) >> 23) as i32 - 127
}

/// `exponent_of(max(abs(a), abs(b)))`, read off the exponent fields without forming the
/// float maximum: WGSL `i32(max(bitcast<u32>(a) & 0x7f800000u, bitcast<u32>(b) &
/// 0x7f800000u) >> 23u) - 127`.
#[inline(always)]
pub fn exponent_of_max(a: f32, b: f32) -> i32 {
    let x = (bits(a) & EXPONENT_MASK).max(bits(b) & EXPONENT_MASK);
    (x >> 23) as i32 - 127
}

/// `2^e` as an `f32`, for `e` in `[-126, 127]`: built from its bits, which is what
/// WGSL's `ldexp(1.0, e)` returns in that range. Outside it the caller has broken a
/// rule, and the debug build says so.
#[inline(always)]
pub fn pow2(e: i32) -> f32 {
    debug_assert!(
        (-126..=127).contains(&e),
        "pow2({e}) is outside the normal range"
    );
    from_bits(((e + 127) as u32) << 23)
}

/// `x · 2^e`, exactly, by integer arithmetic on the exponent field, for any `e`.
///
/// This replaces WGSL's `ldexp`, whose result is only specified while the exponent stays
/// in `[-126, 128]`: here the exponent may be anything an `i32` holds. A zero, a
/// subnormal, an infinity or a NaN comes back as it went in (a subnormal as a signed
/// zero). A result too small to be normal is a signed zero rather than a subnormal, and
/// a result too large is a signed infinity. No rounding happens anywhere: a normal
/// result is `x · 2^e` exactly.
///
/// WGSL, with `b = bitcast<u32>(x)` and `f = i32((b >> 23u) & 0xffu)`:
/// `select(select(bitcast<f32>((b & 0x807fffffu) | (u32(f + e) << 23u)), inf, f + e >= 255),
///  signed_zero, f + e <= 0)`, returning `x` itself when `f == 0` or `f == 255`.
#[inline(always)]
pub fn ldexp_exact(x: f32, e: i32) -> f32 {
    let b = bits(x);
    let field = ((b & EXPONENT_MASK) >> 23) as i32;
    if field == 0 {
        // Zero, or a subnormal flushed to zero, keeping its sign.
        return from_bits(b & 0x8000_0000);
    }
    if field == 255 {
        return x;
    }
    let moved = field.saturating_add(e);
    if moved <= 0 {
        from_bits(b & 0x8000_0000)
    } else if moved >= 255 {
        from_bits((b & 0x8000_0000) | EXPONENT_MASK)
    } else {
        from_bits((b & KEEP_MASK) | ((moved as u32) << 23))
    }
}

/// WGSL's `countTrailingZeros(x)`: 32 for zero.
#[inline(always)]
pub fn count_trailing_zeros(x: u32) -> u32 {
    x.trailing_zeros()
}

/// `max(abs(a), abs(b))`, the size test the delta's renormalization reads.
#[inline(always)]
pub fn max_abs(a: f32, b: f32) -> f32 {
    a.abs().max(b.abs())
}

/// WGSL's `log(x)`, the natural logarithm. The model calls Rust's `f32::ln`, which is
/// correctly rounded or nearly so; WGSL only promises an absolute error of `2^-21` on
/// `[0.5, 2.0]` and 3 ULP elsewhere. The smooth fraction is the only reader, and that
/// difference is far below anything a color map shows.
#[inline(always)]
pub fn log(x: f32) -> f32 {
    x.ln()
}

/// WGSL's `sqrt(x)`. Rust's is correctly rounded; WGSL's accuracy is inherited from
/// `1.0 / inverseSqrt(x)`, 2 ULP and then a 2.5 ULP division, so about 4.5 ULP, under
/// `2^-20.8` relative. The interior proof ([`crate::proof`]) is the only reader, and it
/// rounds every magnitude it takes up by `2^-19`, which covers that.
#[inline(always)]
pub fn sqrt(x: f32) -> f32 {
    x.sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exponent_of_brackets_the_value() {
        for &x in &[1.0f32, 1.5, 2.0, 3.99, 0.75, 1e-30, 6e30, -5.0] {
            let e = exponent_of(x);
            let a = x.abs() as f64;
            assert!(a >= 2f64.powi(e) && a < 2f64.powi(e + 1), "{x} {e}");
        }
        assert_eq!(exponent_of(0.0), -127);
        assert_eq!(exponent_of_max(-3.0, 0.5), 1);
        assert_eq!(exponent_of_max(0.0, -0.0), -127);
        assert_eq!(exponent_of(f32::INFINITY), 128);
    }

    #[test]
    fn ldexp_exact_is_exact_and_saturates() {
        assert_eq!(ldexp_exact(1.5, 3), 12.0);
        assert_eq!(ldexp_exact(-1.5, -3), -0.1875);
        assert_eq!(ldexp_exact(1.0, -126), f32::MIN_POSITIVE);
        assert_eq!(ldexp_exact(1.0, -127).to_bits(), 0);
        assert_eq!(ldexp_exact(-1.0, -400).to_bits(), 0x8000_0000);
        assert_eq!(ldexp_exact(1.0, 128), f32::INFINITY);
        assert_eq!(ldexp_exact(0.0, 500), 0.0);
        assert_eq!(ldexp_exact(3.0, i32::MAX), f32::INFINITY);
        assert_eq!(pow2(-126), f32::MIN_POSITIVE);
        assert_eq!(pow2(10), 1024.0);
    }
}
