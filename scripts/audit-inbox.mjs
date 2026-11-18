// The pre-fix observations are preserved in outputs/inbox-review-20261117/findings.json.
// This entry point now verifies the expected corrected behavior.
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
const result=spawnSync(process.execPath,['--test','--test-reporter=spec','test/inbox-consistency.test.js'],{encoding:'utf8',windowsHide:true});
const out='outputs/inbox-fix-20261117';fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(out+'/regression.txt',(result.stdout??'')+(result.stderr??''));
process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');
if(result.error)console.error(result.error.message);
process.exitCode=result.status??1;
