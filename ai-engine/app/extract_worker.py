"""One short-lived local parser process per upload. Input is supplied via stdin."""
import json
import sys
from .extract import ExtractionError, extract_document


def main() -> None:
    extension = sys.argv[1] if len(sys.argv) == 2 else ''
    if extension not in ('pdf', 'docx'):
        raise SystemExit(2)
    try:
        result = extract_document('resume.' + extension, sys.stdin.buffer.read(), '')
    except ExtractionError:
        # Do not return document content or parser-internal paths in errors.
        result = {'error': 'The document is invalid, unsupported, or exceeds safety limits.'}
    sys.stdout.write(json.dumps(result, ensure_ascii=True))


if __name__ == '__main__':
    main()
