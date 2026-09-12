import json
from pathlib import Path

def main() -> None:
    ips = Path(r'C:\Users\Drawi\Downloads\CardCacheScanner-2026-09-11-222230.ips')
    with open(ips, 'r', encoding='utf-8') as f:
        f.readline()
        payload = json.load(f)

    t = payload['threads'][13]
    print('Thread 13 name:', t.get('name'), 'triggered:', t.get('triggered'))
    print('threadState:', json.dumps(t.get('threadState'), indent=2))


if __name__ == '__main__':
    main()
