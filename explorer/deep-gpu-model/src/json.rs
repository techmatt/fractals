//! Just enough JSON to read a corpus row: one flat object of strings, numbers, booleans
//! and nulls. Nested values are skipped. The crate takes no dependency for this, as
//! `perturb` takes none for its spec.

/// One member's value.
#[derive(Debug, Clone, PartialEq)]
pub enum Value {
    Str(String),
    /// The number's text, unparsed, so a caller can read it as the type it wants.
    Num(String),
    Bool(bool),
    Null,
    /// An array or object, not read.
    Other,
}

impl Value {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Value::Str(s) => Some(s),
            _ => None,
        }
    }

    pub fn as_f64(&self) -> Option<f64> {
        match self {
            Value::Num(s) => s.parse().ok(),
            _ => None,
        }
    }

    pub fn as_u32(&self) -> Option<u32> {
        let x = self.as_f64()?;
        (x >= 0.0 && x <= u32::MAX as f64 && x.fract() == 0.0).then_some(x as u32)
    }
}

/// Parses a flat object into its members, in order.
pub fn parse_object(text: &str) -> Result<Vec<(String, Value)>, String> {
    let mut p = Parser {
        b: text.as_bytes(),
        i: 0,
    };
    p.ws();
    p.expect(b'{')?;
    let mut out = Vec::new();
    p.ws();
    if p.peek() == Some(b'}') {
        return Ok(out);
    }
    loop {
        p.ws();
        let key = p.string()?;
        p.ws();
        p.expect(b':')?;
        p.ws();
        let value = p.value()?;
        out.push((key, value));
        p.ws();
        match p.next() {
            Some(b',') => continue,
            Some(b'}') => return Ok(out),
            _ => return Err(format!("expected , or }} at byte {}", p.i)),
        }
    }
}

/// The member named `key`, if present.
pub fn get<'a>(members: &'a [(String, Value)], key: &str) -> Option<&'a Value> {
    members.iter().find(|(k, _)| k == key).map(|(_, v)| v)
}

struct Parser<'a> {
    b: &'a [u8],
    i: usize,
}

impl Parser<'_> {
    fn peek(&self) -> Option<u8> {
        self.b.get(self.i).copied()
    }

    fn next(&mut self) -> Option<u8> {
        let c = self.peek();
        self.i += 1;
        c
    }

    fn ws(&mut self) {
        while matches!(self.peek(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.i += 1;
        }
    }

    fn expect(&mut self, c: u8) -> Result<(), String> {
        if self.next() == Some(c) {
            Ok(())
        } else {
            Err(format!("expected {} at byte {}", c as char, self.i - 1))
        }
    }

    fn string(&mut self) -> Result<String, String> {
        self.expect(b'"')?;
        let mut out = Vec::new();
        loop {
            match self.next() {
                None => return Err("unterminated string".into()),
                Some(b'"') => break,
                Some(b'\\') => match self.next() {
                    Some(b'n') => out.push(b'\n'),
                    Some(b't') => out.push(b'\t'),
                    Some(b'u') => {
                        let hex = self.b.get(self.i..self.i + 4).ok_or("short \\u escape")?;
                        let code = u32::from_str_radix(std::str::from_utf8(hex).unwrap_or(""), 16)
                            .map_err(|e| e.to_string())?;
                        self.i += 4;
                        let ch = char::from_u32(code).unwrap_or('\u{fffd}');
                        let mut buf = [0u8; 4];
                        out.extend_from_slice(ch.encode_utf8(&mut buf).as_bytes());
                    }
                    Some(c) => out.push(c),
                    None => return Err("unterminated escape".into()),
                },
                Some(c) => out.push(c),
            }
        }
        String::from_utf8(out).map_err(|e| e.to_string())
    }

    fn value(&mut self) -> Result<Value, String> {
        match self.peek() {
            Some(b'"') => Ok(Value::Str(self.string()?)),
            Some(b'n') => self.word("null", Value::Null),
            Some(b't') => self.word("true", Value::Bool(true)),
            Some(b'f') => self.word("false", Value::Bool(false)),
            Some(b'[' | b'{') => {
                self.skip_nested()?;
                Ok(Value::Other)
            }
            Some(_) => {
                let start = self.i;
                while matches!(
                    self.peek(),
                    Some(b'-' | b'+' | b'.' | b'e' | b'E' | b'0'..=b'9')
                ) {
                    self.i += 1;
                }
                if self.i == start {
                    return Err(format!("unexpected byte at {}", self.i));
                }
                let text = std::str::from_utf8(&self.b[start..self.i]).unwrap_or("");
                Ok(Value::Num(text.to_string()))
            }
            None => Err("unexpected end".into()),
        }
    }

    fn word(&mut self, w: &str, v: Value) -> Result<Value, String> {
        if self.b[self.i..].starts_with(w.as_bytes()) {
            self.i += w.len();
            Ok(v)
        } else {
            Err(format!("expected {w} at byte {}", self.i))
        }
    }

    fn skip_nested(&mut self) -> Result<(), String> {
        let mut depth = 0i32;
        loop {
            match self.peek() {
                None => return Err("unterminated array or object".into()),
                Some(b'"') => {
                    self.string()?;
                    continue;
                }
                Some(b'[' | b'{') => depth += 1,
                Some(b']' | b'}') => {
                    depth -= 1;
                    if depth == 0 {
                        self.i += 1;
                        return Ok(());
                    }
                }
                _ => {}
            }
            self.i += 1;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_corpus_row() {
        let row = r#"{"id": "a#1", "re": "-0.5", "w": 2.5e-15, "n": 1000, "julia_re": null, "x": [1, {"y": "]"}], "ok": true}"#;
        let m = parse_object(row).unwrap();
        assert_eq!(get(&m, "id").unwrap().as_str(), Some("a#1"));
        assert_eq!(get(&m, "w").unwrap().as_f64(), Some(2.5e-15));
        assert_eq!(get(&m, "n").unwrap().as_u32(), Some(1000));
        assert_eq!(get(&m, "julia_re"), Some(&Value::Null));
        assert_eq!(get(&m, "x"), Some(&Value::Other));
        assert_eq!(get(&m, "ok"), Some(&Value::Bool(true)));
    }
}
