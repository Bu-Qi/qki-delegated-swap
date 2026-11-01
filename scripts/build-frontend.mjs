import fs from 'node:fs';
fs.mkdirSync('docs/vendor',{recursive:true});
fs.copyFileSync('node_modules/ethers/dist/ethers.umd.min.js','docs/vendor/ethers.umd.min.js');
fs.copyFileSync('node_modules/ethers/LICENSE.md','docs/vendor/ETHERS-LICENSE.md');
fs.copyFileSync('build/QKIDelegatedMultiHop.abi.json','docs/contract.abi.json');
fs.copyFileSync('build/contract-verification.json','docs/trusted-bytecode.json');
fs.writeFileSync('docs/.nojekyll','');
console.log('Static frontend ready in docs/; all signing code is served locally.');
