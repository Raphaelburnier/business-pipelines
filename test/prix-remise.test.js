const {test}=require('node:test');const assert=require('node:assert/strict');
const {prixApresRemise}=require('../src/prix-remise');
test('prixApresRemise réduit le prix selon le taux',()=>{
 assert.equal(prixApresRemise(100,10),90);
 assert.equal(prixApresRemise(100,100),0);
 assert.equal(prixApresRemise(100,0),100);
});
test('prixApresRemise rejette un prix ou un taux invalide',()=>{
 assert.throws(()=>prixApresRemise(-1,10),TypeError);
 assert.throws(()=>prixApresRemise(100,101),TypeError);
});
