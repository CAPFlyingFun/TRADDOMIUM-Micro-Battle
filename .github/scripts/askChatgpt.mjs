/**
 * ASK THE OPENAI API ONE QUESTION, FROM A GITHUB RUNNER.
 *
 * Driven entirely by the environment `ask-chatgpt.yml` hands it. It runs
 * on a runner and nowhere else: the key it needs is a repository secret,
 * which exists in decrypted form only inside a workflow step.
 *
 * TWO MODES, AND THE DEFAULT ONE IS FREE. `list-models` asks which models
 * the key can reach and spends nothing, which makes it the honest way to
 * answer "does the key work" without a bill. `ask` is the one that costs.
 *
 * A WRONG MODEL ID FAILS WITH THE RIGHT ONES. Model names move faster than
 * a workflow file's defaults, so rather than guess and return an opaque
 * 404, a failed completion re-queries `/v1/models` and prints the chat
 * models the key can actually see. The next run is then a correct one.
 *
 * THE KEY IS NEVER PRINTED. Not on success, not in an error body — the
 * error path prints status and the response's own message, both of which
 * come from OpenAI and neither of which carries the key.
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const KEY = process.env.OPENAI_API_KEY ?? '';
const MODE = process.env.MODE ?? 'list-models';
const PROMPT = (process.env.PROMPT ?? '').trim();
const CONTEXT = (process.env.CONTEXT ?? '').trim();
const MODEL = (process.env.MODEL ?? 'gpt-4o').trim();
const MAX_TOKENS = Math.max(1, Math.min(32000, Number(process.env.MAX_TOKENS) || 4000));

/** Everything a reader should see, in the log and in the artifact. */
const out = [];
const say = (line) => { console.log(line); out.push(line); };
const finish = (code) => {
  writeFileSync('chatgpt-answer.md', out.join('\n') + '\n');
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, out.join('\n') + '\n');
  process.exit(code);
};

const api = async (path, init) => {
  const res = await fetch(`https://api.openai.com/v1${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = await res.text();
  let json = null;
  try { json = JSON.parse(body); } catch { /* a non-JSON body is reported as text */ }
  return { ok: res.ok, status: res.status, json, body };
};

const chatModels = async () => {
  const res = await api('/models', { method: 'GET' });
  if (!res.ok) return null;
  return (res.json?.data ?? [])
    .map((m) => m.id)
    .filter((id) => /^(gpt|o[0-9]|chatgpt)/.test(id))
    .sort();
};

if (MODE === 'list-models') {
  const ids = await chatModels();
  if (ids === null) {
    say('## The key did not work');
    say('');
    say('`GET /v1/models` was refused. The key is present but the API would not accept it.');
    finish(1);
  }
  say(`## ${ids.length} chat models this key can reach`);
  say('');
  for (const id of ids) say(`- \`${id}\``);
  say('');
  say('Nothing was generated and nothing was spent. Put one of these in `model` and run with `mode: ask`.');
  finish(0);
}

if (PROMPT === '') {
  say('## Nothing to ask');
  say('');
  say('`mode: ask` needs a `prompt`.');
  finish(1);
}

// CONTEXT IS READ HERE, not pasted into the dispatch form: a path is short
// and a file is not, and a file read from the checkout is the version this
// commit actually holds rather than whatever was copied by hand.
const parts = [];
for (const rel of CONTEXT.split(',').map((s) => s.trim()).filter(Boolean)) {
  if (rel.includes('..')) { say(`Refused a path that climbs out of the repo: \`${rel}\``); finish(1); }
  try {
    parts.push(`----- ${rel} -----\n${readFileSync(rel, 'utf8')}`);
  } catch {
    say(`Could not read \`${rel}\` — is the path right, relative to the repo root?`);
    finish(1);
  }
}

const system = [
  'You are advising on TRADDOMIUM: Micro Battle, a browser three.js + TypeScript game.',
  'You are being consulted for a second opinion by another assistant working in the repository.',
  'Be concrete and brief. Say plainly when you are unsure rather than inventing specifics.',
  'You cannot run code, see the running game, or browse; answer only from what is in this message.',
].join(' ');

const user = parts.length > 0
  ? `${PROMPT}\n\nThe relevant files follow verbatim.\n\n${parts.join('\n\n')}`
  : PROMPT;

const res = await api('/chat/completions', {
  method: 'POST',
  body: JSON.stringify({
    model: MODEL,
    max_completion_tokens: MAX_TOKENS,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  }),
});

if (!res.ok) {
  say(`## The request failed (HTTP ${res.status})`);
  say('');
  say(res.json?.error?.message ?? res.body.slice(0, 600));
  const ids = await chatModels();
  if (ids?.length) {
    say('');
    say(`\`${MODEL}\` may not be one this key can use. It can reach:`);
    say('');
    for (const id of ids) say(`- \`${id}\``);
  }
  finish(1);
}

const answer = res.json?.choices?.[0]?.message?.content ?? '';
const used = res.json?.usage ?? {};
say(`## ${MODEL}`);
say('');
say(answer.trim() === '' ? '_(empty reply)_' : answer);
say('');
say('---');
say(`_tokens: ${used.prompt_tokens ?? '?'} in, ${used.completion_tokens ?? '?'} out_`);
finish(0);
