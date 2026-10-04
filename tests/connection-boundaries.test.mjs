import test from "node:test";
import assert from "node:assert/strict";
import { saveSecretSession } from "../services/agent/src/memory.mjs";
import { encryptToken } from "../services/agent/src/swiggy-auth.mjs";
import { createLiveCaller } from "../services/agent/src/swiggy-client.mjs";
import { prepareCart, confirmPreparedCart, isOrderable } from "../services/agent/src/cart-preparation.mjs";

test("live caller refuses a different account before contacting Swiggy", async () => {
 const id = "boundary-caller";
 const record = version => ({version,accessToken:encryptToken("token"),expiresAt:Date.now()+3600000});
 await saveSecretSession(`swiggy:${id}`,record("A"));
 const caller=createLiveCaller(id);
 assert.equal(await caller.connectionVersion(),"A");
 await saveSecretSession(`swiggy:${id}`,record("B"));
 await assert.rejects(caller("food","update_food_cart",{}),e=>e.status===409);
});

test("cart confirmation rejects reconnect during asynchronous preflight", async () => {
 const ownerId="boundary-cart";
 await saveSecretSession(`swiggy:${ownerId}`,{version:"A"});
 let confirming=false,writes=0;
 const item={itemId:"dish",name:"Dish",price:100,quantity:1};
 const swiggy={mode:"live",getAddresses:async()=>{if(confirming)await saveSecretSession(`swiggy:${ownerId}`,{version:"B"});return [{id:"addr",label:"Home",display:"same"}]},getRestaurantMenu:async()=>({items:[item]}),searchMenu:async()=>[item],getFoodCart:async()=>({restaurantId:"",total:0,items:[]})};
 const recommendation={recommendationId:"rec",address:{id:"addr"},options:[{optionId:"option",restaurantId:"restaurant",items:[item]}]};
 const prep=await prepareCart({ownerId,recommendation,optionId:"option",swiggy});
 confirming=true;
 await assert.rejects(confirmPreparedCart({preparationId:prep.preparationId,ownerId,recommendation,optionId:"option",confirmed:true,swiggy,build:async()=>{writes++;return {foodCarts:[{restaurantId:"restaurant",items:[item]}]}}}),e=>e.status===409);
 assert.equal(writes,0);
});

test("numeric availability flags and negative prices cannot pass cart review", () => {
 for (const field of ["inStock", "in_stock", "isAvailable", "isAvail"]) {
   for (const flag of [false, 0]) assert.equal(isOrderable({price:100,[field]:flag}),false);
 }
 assert.equal(isOrderable({price:-1}),false);
 assert.equal(isOrderable({price:0,in_stock:1}),true);
});

test("repeated tool cursors stop without issuing a tool call", async t => {
 const { installFakeSwiggy } = await import("./helpers/fake-swiggy.mjs");
 const fake=installFakeSwiggy();
 const intercepted=globalThis.fetch;
 t.after(()=>fake.restore());
 let pages=0;
 globalThis.fetch=async (input,init={})=>{
   const body=init.body ? JSON.parse(init.body) : {};
   if(body.method==="tools/list") {
     pages++;
     return new Response(JSON.stringify({jsonrpc:"2.0",id:body.id,result:{tools:[],nextCursor:"repeat"}}),{headers:{"content-type":"application/json"}});
   }
   return intercepted(input,init);
 };
 const id="boundary-pagination";
 await saveSecretSession(`swiggy:${id}`,{version:"A",accessToken:encryptToken("token"),expiresAt:Date.now()+3600000});
 await assert.rejects(createLiveCaller(id)("food","get_addresses",{}),e=>e.code==="SWIGGY_CAPABILITY_INVALID");
 assert.equal(pages,2);
 assert.equal(fake.state.calls.length,0);
});
