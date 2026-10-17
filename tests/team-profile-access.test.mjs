import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "../services/agent/src/server.mjs";
import { updateTeamProfile, getTeamProfile } from "../services/agent/src/memory.mjs";
import { signSessionToken } from "../services/agent/src/auth.mjs";

test("public office routes cannot read or clear a caller-selected saved team", async t => {
 const old=process.env.SWIGGY_MODE;
 process.env.SWIGGY_MODE="fixture";
 const id="access-test-private-team";
 await updateTeamProfile(id,{headcount:13,cuisineAvoidList:["private-marker"]});
 const server=createServer();
 await new Promise(r=>server.listen(0,"127.0.0.1",r));
 t.after(async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));if(old===undefined)delete process.env.SWIGGY_MODE;else process.env.SWIGGY_MODE=old;});
 const base=`http://127.0.0.1:${server.address().port}`;
 for(const auth of [null,signSessionToken({id:"unrelated-user"})]) {
  const headers={"content-type":"application/json",...(auth?{"x-moodish-session":auth}:{})};
  const response=await fetch(base+"/api/recommendations/office",{method:"POST",headers,body:JSON.stringify({teamId:id})});
  assert.equal(response.status,200);
  const run=await response.json();
  assert.equal(run.request.headcount,6);
  assert.equal(JSON.stringify(run).includes("private-marker"),false);
  const clear=await fetch(base+"/api/privacy/clear-team-history",{method:"POST",headers,body:JSON.stringify({teamId:id})});
  assert.equal(clear.status,403);
 }
 assert.deepEqual((await getTeamProfile(id)).cuisineAvoidList,["private-marker"]);
});
