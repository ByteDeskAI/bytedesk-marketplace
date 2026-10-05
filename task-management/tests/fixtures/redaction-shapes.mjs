// TM-435: every secret shape enhance-mine must redact, as [input, the secret that must vanish, endsLine].
// One list feeds both checks in test-enhance-mine.sh: the redaction table, and the probe lines planted in
// the fixture transcript whose board output is asserted. A shape added here is checked both ways.
// Values are assembled from pieces so no committed line matches a secret scanner's token pattern.
const B = 'Bea' + 'rer';
const A = 'Authori' + 'zation';
const pad = (n) => 'abcdefghijkmnopqrstuvwxyz23456789'.repeat(3).slice(0, n);

export const SHAPES = [
  // Authorization and bearer values, not just the scheme word.
  [`${A}: ${B} abcVAL9xyz`, 'abcVAL9xyz'],
  [`authorization: "${B} quotedVAL9x"`, 'quotedVAL9x'],
  [`${A}: Basic dXNlcjpwYXNz9x==`, 'dXNlcjpwYXNz9x'],
  [`${A}: token tokVAL9xyz`, 'tokVAL9xyz'],
  [`${A}: Digest dgVAL9x`, 'dgVAL9x'],
  [`X-Api: ${B} bareVAL9xyz`, 'bareVAL9xyz'],
  [`X-Auth-User: xaVAL9x`, 'xaVAL9x'],
  [`X-Auth-Token: "q xatVAL9x"`, 'xatVAL9x'],
  // URL credentials.
  ['https://alice:httpPW9x@example.com/repo.git', 'httpPW9x'],
  ['postgres://app:pgPW9x@db:5432/app', 'pgPW9x'],
  ['redis://:onlyPW9x@cache:6379', 'onlyPW9x'],
  // Command-line passwords and tokens.
  ['mysql -u root -pmyPW9x mydb', 'myPW9x'],
  ['sshpass -p sshVAL9x ssh host', 'sshVAL9x'],
  ['cli --token tkVAL9x', 'tkVAL9x'],
  ['gh auth login --with-token wtVAL9x', 'wtVAL9x'],
  ['vault --secret scVAL9x', 'scVAL9x'],
  ['cli --api-key akVAL9x', 'akVAL9x'],
  ['cli --password pwfVAL9x', 'pwfVAL9x'],
  // NAME=value and key: value, including quoted values with spaces.
  ['PGPASSWORD=envPW9x psql', 'envPW9x'],
  ['X=shortPW9x', 'shortPW9x'],
  ['DEPLOY_KEY=deployPW9x make deploy', 'deployPW9x'],
  ['DB_PASSWORD: "letmeinPW9x"', 'letmeinPW9x'],
  ['{"token": "qa1 qtokVAL9x"}', 'qtokVAL9x'],
  ["DB_PASSWORD='hunter qpwVAL9x'", 'qpwVAL9x'],
  ['client_secret: "x y qcsVAL9x"', 'qcsVAL9x'],
  ['pass=passVAL9x', 'passVAL9x'],
  ['key=keyVAL9x', 'keyVAL9x'],
  // Prose.
  ['the password is swordfishPW9x', 'swordfishPW9x'],
  ['secret sprVAL9x', 'sprVAL9x'],
  // Cookies.
  ["curl -b 'session=cbVAL9x' https://x.example", 'cbVAL9x'],
  ['curl --cookie ccVAL9x https://x.example', 'ccVAL9x'],
  ['Cookie: session=ckVAL9x; theme=dark', 'ckVAL9x', true],
  ['Set-Cookie: sid=sckVAL9x; Path=/; HttpOnly', 'sckVAL9x', true],
  // Vendor prefixes.
  [`glp${'at-'}glVAL9x${pad(14)}`, 'glVAL9x'],
  [`np${'m_'}npmval9x${pad(28)}`, 'npmval9x'],
  [`s${'k_live_'}skVAL9x${pad(12)}`, 'skVAL9x'],
  [`r${'k_live_'}rkVAL9x${pad(12)}`, 'rkVAL9x'],
  [`AI${'za'}gkVAL9x${pad(28)}`, 'gkVAL9x'],
  // rv-222 final round.
  ['curl -u alice:cuVAL9x https://x.example', 'cuVAL9x'],
  ['tool --auth alice:auVAL9x', 'auVAL9x'],
  ['redis-cli -a rdVAL9x ping', 'rdVAL9x'],
  ['docker login -u bob -p dkVAL9x reg.example', 'dkVAL9x'],
  ['docker login -u bob -P dkPVAL9x reg.example', 'dkPVAL9x'],
  ['https://tokVAL9x@github.com/org/repo.git', 'tokVAL9x'],
  [`https://${'onlylettersuserinfoxyz'}@host.example/x`, 'onlylettersuserinfoxyz'],
  // 39 characters after the prefix: the whole run goes. The secret is the 4-character tail that a rule
  // stopping at 35 would leave behind.
  [`AI${'za'}${pad(35)}Q9zX`, 'Q9zX'],
  [`ya${'29.'}yaVAL9x${pad(20)}`, 'yaVAL9x'],
  [`h${'f_'}hfVAL9x${pad(24)}`, 'hfVAL9x'],
  ['DefaultEndpointsProtocol=https;AccountKey=azVAL9x/ab+cd==;EndpointSuffix=core', 'azVAL9x'],
  ['https://acct.blob.example/c?sv=2020&sig=sgVAL9x', 'sgVAL9x'],
  ['signature=snVAL9x', 'snVAL9x'],
  ['https://b.s3.example/k?X-Amz-Signature=amzVAL9x', 'amzVAL9x'],
  ['passphrase=ppVAL9x', 'ppVAL9x'],
  ['gpg --passphrase gpVAL9x', 'gpVAL9x'],
  ['session_id=sidVAL9x', 'sidVAL9x'],
  ['sid=sid2VAL9x', 'sid2VAL9x'],
  ['otp: otpVAL9x', 'otpVAL9x'],
  ['pin=pinVAL9x', 'pinVAL9x'],
  ['PGPASSWORD pgsVAL9x psql', 'pgsVAL9x'],
  ['the token is tisVAL9x', 'tisVAL9x'],
  ['the secret is sisVAL9x', 'sisVAL9x'],
  ['{"secret": "he said \\"hi\\" jsVAL9x"}', 'jsVAL9x'],
  ['{"secret": "he said \\"jqVAL9x\\" ok"}', 'jqVAL9x'],
  // A PGP private key block.
  ['-----BEGIN PGP PRIVATE KEY BLOCK----- pgpVAL9x -----END PGP PRIVATE KEY BLOCK-----', 'pgpVAL9x', true],
];

/** The shapes as transcript lines, each tagged with its own error code so each becomes a board item,
 * and each well under the 160-character sample cut, so an unredacted secret WOULD reach the board.
 * A shape that consumes to the end of the line closes its line. */
export function probeLines(max = 150) {
  const lines = [];
  let parts = [];
  const tag = () => `REDACT_PROBE_${String(lines.length + 1).padStart(2, '0')}:`;
  const flush = () => { if (parts.length) lines.push([tag(), ...parts].join(' ')); parts = []; };
  for (const [input, , endsLine] of SHAPES) {
    if ([tag(), ...parts, input].join(' ').length > max) flush();
    parts.push(input);
    if (endsLine) flush();
  }
  flush();
  return lines;
}
