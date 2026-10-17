import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import { updateTeamProfile, clearTeamHistory } from "../services/agent/src/memory.mjs";

test("team preferences and clearing survive a fresh process", {skip:!process.env.DATABASE_URL}, async () => {
 const id=`team-persistence-${crypto.randomUUID()}`;
 await updateTeamProfile(id,{cuisineAvoidList:["pizza"],headcount:7});
 const moduleUrl=new URL("../services/agent/src/memory.mjs",import.meta.url).href;
 const read=async()=>{
  const code=`import {getTeamProfile} from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(await getTeamProfile(${JSON.stringify(id)})));process.exit(0);`;
  const {stdout}=await promisify(execFile)(process.execPath,["--input-type=module","-e",code],{env:process.env,timeout:10000});
  return JSON.parse(stdout);
 };
 assert.deepEqual((await read()).cuisineAvoidList,["pizza"]);
 await clearTeamHistory(id);
 const fresh=await read();
 assert.deepEqual(fresh.cuisineAvoidList,[]);
 assert.equal(fresh.headcount,7);
});
