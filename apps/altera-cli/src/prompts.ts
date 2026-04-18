/**
 * Tiny stdin prompter — avoids pulling in a deps for Sprint 1.
 */
export async function prompt(question: string): Promise<string> {
  process.stdout.write(question);
  for await (const line of console) {
    return line;
  }
  return '';
}

export async function promptHidden(question: string): Promise<string> {
  process.stdout.write(question);
  const stdin = process.stdin;
  const tty = (stdin as unknown as { isTTY?: boolean }).isTTY;

  if (
    !tty ||
    typeof (stdin as unknown as { setRawMode?: (v: boolean) => unknown }).setRawMode !== 'function'
  ) {
    return prompt('');
  }

  return new Promise<string>((resolve) => {
    (stdin as unknown as { setRawMode: (v: boolean) => void }).setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf-8');

    let buf = '';
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === '\n' || ch === '\r') {
          stdin.off('data', onData);
          (stdin as unknown as { setRawMode: (v: boolean) => void }).setRawMode(false);
          stdin.pause();
          process.stdout.write('\n');
          resolve(buf);
          return;
        }
        if (ch === '\u0003') {
          process.exit(130);
        }
        if (ch === '\u0008' || ch === '\u007f') {
          buf = buf.slice(0, -1);
        } else {
          buf += ch;
        }
      }
    };
    stdin.on('data', onData);
  });
}
