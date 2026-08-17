"""Reading the metadata files.

Every metadata file here is JSONL: one JSON object per line, each carrying an integer
`schema`. A line that announces a schema this builder does not know is an error rather
than a guess — which is the whole reason the key is there. Line order is meaningful:
it is the order things appear on the page.
"""

import json
from dataclasses import dataclass
from pathlib import Path

SCHEMA = 1


class RecordError(Exception):
    """A metadata file said something the builder will not guess at."""


@dataclass(frozen=True)
class Record:
    """One line of a metadata file, with the position it came from for error messages."""

    source: Path
    line: int
    fields: dict

    @property
    def where(self) -> str:
        return f"{self.source.name}:{self.line}"

    @property
    def kind(self) -> str:
        return self.text("kind")

    def text(self, key: str) -> str:
        value = self.fields.get(key)
        if not isinstance(value, str) or not value:
            raise RecordError(f"{self.where}: {key} must be a non-empty string")
        return value

    def optional_text(self, key: str) -> str | None:
        value = self.fields.get(key)
        if value is None:
            return None
        if not isinstance(value, str) or not value:
            raise RecordError(f"{self.where}: {key} must be a non-empty string when present")
        return value

    def count(self, key: str) -> int:
        value = self.fields.get(key)
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            raise RecordError(f"{self.where}: {key} must be a positive integer")
        return value

    def expect_kind(self, kind: str) -> None:
        if self.kind != kind:
            raise RecordError(f"{self.where}: expected a {kind!r} record, found {self.kind!r}")


def read(path: Path) -> list[Record]:
    """Every record in a JSONL metadata file, in file order."""
    if not path.is_file():
        raise RecordError(f"{path.name}: no such metadata file")
    records: list[Record] = []
    with path.open(encoding="utf-8") as handle:
        for line, raw in enumerate(handle, start=1):
            if not raw.strip():
                continue
            try:
                fields = json.loads(raw)
            except json.JSONDecodeError as error:
                raise RecordError(f"{path.name}:{line}: {error.msg}") from error
            if not isinstance(fields, dict):
                raise RecordError(f"{path.name}:{line}: a record must be a JSON object")
            if fields.get("schema") != SCHEMA:
                raise RecordError(
                    f"{path.name}:{line}: schema {fields.get('schema')!r}, this builder reads "
                    f"{SCHEMA}"
                )
            records.append(Record(path, line, fields))
    if not records:
        raise RecordError(f"{path.name}: no records")
    return records
