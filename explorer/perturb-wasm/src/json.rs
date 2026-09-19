//! A reader for one flat JSON object, and nothing else.
//!
//! `engine-wasm` crosses its boundary with `serde` and `serde_json` because the
//! spec it carries is the engine's own — a family, a mode, a palette recipe, a
//! colormap's stops — and there is exactly one right spelling of all of it, next
//! door. This crate's spec is eleven scalars. Pulling in a general parser for
//! them would be most of the module's bytes, and the module's size is one of the
//! numbers the README has to report.
//!
//! So: an object at the top level, string / number / bool / null values, and one
//! array of numbers. Nested objects, escapes beyond the six JSON names them, and
//! anything else are refused rather than half-read.
//!
//! **Numbers go through `str::parse::<f64>`**, which is Rust's own
//! correctly-rounded decimal reader. That is not a detail: `serde_json`'s default
//! parser is the fast one and reads a 17-digit decimal one ulp out about one time
//! in ten, which is why `engine-wasm` turns `float_roundtrip` on. Here the
//! exactness is free.

/// One value of a flat object.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Str(String),
    Num(f64),
    Bool(bool),
    Null,
    Nums(Vec<f64>),
}

/// The members of a flat JSON object, in the order they were written.
pub struct Object(Vec<(String, Value)>);

impl Object {
    pub fn get(&self, key: &str) -> Option<&Value> {
        self.0.iter().find(|(name, _)| name == key).map(|(_, v)| v)
    }

    /// Every key the caller did not ask about, so a spec can refuse an unknown
    /// member rather than ignore it — the engine's `deny_unknown_fields`, by
    /// hand. A knob that silently did nothing would look exactly like a knob that
    /// worked.
    pub fn unknown(&self, known: &[&str]) -> Option<String> {
        self.0
            .iter()
            .map(|(name, _)| name)
            .find(|name| !known.contains(&name.as_str()))
            .cloned()
    }
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn space(&mut self) {
        while self.at < self.bytes.len() && self.bytes[self.at].is_ascii_whitespace() {
            self.at += 1;
        }
    }

    fn peek(&mut self) -> Option<u8> {
        self.space();
        self.bytes.get(self.at).copied()
    }

    fn eat(&mut self, byte: u8) -> bool {
        if self.peek() == Some(byte) {
            self.at += 1;
            true
        } else {
            false
        }
    }

    fn string(&mut self) -> Option<String> {
        if !self.eat(b'"') {
            return None;
        }
        let mut out = String::new();
        loop {
            let byte = *self.bytes.get(self.at)?;
            self.at += 1;
            match byte {
                b'"' => return Some(out),
                b'\\' => {
                    let escape = *self.bytes.get(self.at)?;
                    self.at += 1;
                    out.push(match escape {
                        b'"' => '"',
                        b'\\' => '\\',
                        b'/' => '/',
                        b'n' => '\n',
                        b't' => '\t',
                        b'r' => '\r',
                        // `\b`, `\f` and `\uXXXX` have no business in a decimal
                        // coordinate, and guessing at one would be worse than
                        // refusing the spec.
                        _ => return None,
                    });
                }
                _ => {
                    // Multi-byte UTF-8 passes through a byte at a time; the string
                    // is rebuilt from the same bytes, so it stays valid.
                    let start = self.at - 1;
                    let mut end = self.at;
                    while end < self.bytes.len()
                        && self.bytes[end] != b'"'
                        && self.bytes[end] != b'\\'
                    {
                        end += 1;
                    }
                    out.push_str(core::str::from_utf8(&self.bytes[start..end]).ok()?);
                    self.at = end;
                }
            }
        }
    }

    fn number(&mut self) -> Option<f64> {
        self.space();
        let start = self.at;
        while self.at < self.bytes.len() {
            match self.bytes[self.at] {
                b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9' => self.at += 1,
                _ => break,
            }
        }
        core::str::from_utf8(&self.bytes[start..self.at])
            .ok()?
            .parse()
            .ok()
    }

    fn word(&mut self, word: &str) -> bool {
        self.space();
        if self.bytes[self.at..].starts_with(word.as_bytes()) {
            self.at += word.len();
            true
        } else {
            false
        }
    }

    fn value(&mut self) -> Option<Value> {
        match self.peek()? {
            b'"' => self.string().map(Value::Str),
            b't' => self.word("true").then_some(Value::Bool(true)),
            b'f' => self.word("false").then_some(Value::Bool(false)),
            b'n' => self.word("null").then_some(Value::Null),
            b'[' => {
                self.at += 1;
                let mut items = Vec::new();
                if self.eat(b']') {
                    return Some(Value::Nums(items));
                }
                loop {
                    // `null` inside an array of numbers is the engine's own
                    // spelling for a sample with no value, and it reads back as
                    // the `NaN` the field carries. Nowhere else does a `null`
                    // become a number.
                    items.push(if self.word("null") {
                        f64::NAN
                    } else {
                        self.number()?
                    });
                    if self.eat(b']') {
                        return Some(Value::Nums(items));
                    }
                    if !self.eat(b',') {
                        return None;
                    }
                }
            }
            _ => self.number().map(Value::Num),
        }
    }
}

/// Read one flat object, or say nothing about why — the caller's refusal is the
/// one a reader sees, and it can say more than a parser can.
pub fn object(text: &str) -> Option<Object> {
    let mut reader = Reader {
        bytes: text.as_bytes(),
        at: 0,
    };
    if !reader.eat(b'{') {
        return None;
    }
    let mut members = Vec::new();
    if reader.eat(b'}') {
        return Some(Object(members));
    }
    loop {
        let key = reader.string()?;
        if !reader.eat(b':') {
            return None;
        }
        members.push((key, reader.value()?));
        if reader.eat(b'}') {
            reader.space();
            return (reader.at == reader.bytes.len()).then_some(Object(members));
        }
        if !reader.eat(b',') {
            return None;
        }
    }
}

/// A JSON string literal, for the one place this module writes rather than
/// reads: a refusal carries a sentence a reader sees.
pub fn quote(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for character in text.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            c if (c as u32) < 0x20 => out.push(' '),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_flat_object_reads_back() {
        let object = object(
            r#"{"center_re": "-0.745", "width": 2e-11, "resolution": [480, 270],
                "interior": true, "period": null}"#,
        )
        .unwrap();
        assert_eq!(
            object.get("center_re"),
            Some(&Value::Str("-0.745".to_string()))
        );
        assert_eq!(object.get("width"), Some(&Value::Num(2e-11)));
        assert_eq!(
            object.get("resolution"),
            Some(&Value::Nums(vec![480.0, 270.0]))
        );
        assert_eq!(object.get("interior"), Some(&Value::Bool(true)));
        assert_eq!(object.get("period"), Some(&Value::Null));
        assert_eq!(object.get("nothing"), None);
    }

    #[test]
    fn an_unknown_member_is_found_rather_than_ignored() {
        let object = object(r#"{"width": 1, "wdith": 2}"#).unwrap();
        assert_eq!(object.unknown(&["width"]), Some("wdith".to_string()));
        assert_eq!(object.unknown(&["width", "wdith"]), None);
    }

    #[test]
    fn a_seventeen_digit_decimal_reads_exactly() {
        let object = object(r#"{"w": 0.30000000000000004}"#).unwrap();
        assert_eq!(object.get("w"), Some(&Value::Num(0.1 + 0.2)));
    }

    #[test]
    fn malformed_text_is_refused() {
        assert!(object("").is_none());
        assert!(object("[1,2]").is_none());
        assert!(object(r#"{"a": 1"#).is_none());
        assert!(object(r#"{"a": {"b": 1}}"#).is_none());
        assert!(object(r#"{"a": 1} trailing"#).is_none());
        assert!(object(r#"{"a": tru}"#).is_none());
    }

    #[test]
    fn the_empty_object_is_legal() {
        assert!(object("{}").is_some());
        assert!(object("  { }  ").is_some());
    }
}
