import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import { keccak256 } from 'ethers';

export function compile(includeTests = false) {
  const sources = {};
  for (const directory of ['contracts', ...(includeTests ? ['test/contracts'] : [])]) {
    for (const file of fs.readdirSync(directory).filter(n => n.endsWith('.sol'))) {
      const key = `${directory}/${file}`;
      sources[key] = { content: fs.readFileSync(key, 'utf8') };
    }
  }
  const input = {
    language: 'Solidity', sources,
    settings: {
      optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris',
      outputSelection: { '*': { '*': ['abi', 'storageLayout', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences', 'metadata'] } }
    }
  };
  const imports = {};
  const output = JSON.parse(solc.compile(JSON.stringify(input), {
    import(name) {
      try {
        const content = fs.readFileSync(path.join('node_modules', name), 'utf8');
        imports[name] = { content };
        return { contents: content };
      } catch { return { error: `Import not found: ${name}` }; }
    }
  }));
  for (const error of output.errors || []) {
    if (error.severity === 'error') throw new Error(error.formattedMessage);
    process.stderr.write(`${error.formattedMessage}\n`);
  }
  return { output, input: { ...input, sources: { ...sources, ...imports } } };
}

export function writeArtifacts() {
  const { output, input } = compile(false);
  const artifact = output.contracts['contracts/QKIDelegatedMultiHop.sol'].QKIDelegatedMultiHop;
  fs.mkdirSync('build', { recursive: true });
  fs.writeFileSync('build/QKIDelegatedMultiHop.abi.json', JSON.stringify(artifact.abi, null, 2));
  fs.writeFileSync('build/QKIDelegatedMultiHop.bin', artifact.evm.bytecode.object + '\n');
  fs.writeFileSync('build/standard-input.json', JSON.stringify(input, null, 2));
  fs.writeFileSync('build/compiler.json', JSON.stringify({
    version: solc.version(), optimizer: input.settings.optimizer,
    evmVersion: input.settings.evmVersion,
    deployedBytecodeBytes: artifact.evm.deployedBytecode.object.length / 2
  }, null, 2));

  // Flatten pinned dependencies unchanged apart from import/pragma/SPDX directives.
  const visited = new Set();
  function flatten(name) {
    if (visited.has(name)) return '';
    visited.add(name);
    let source = input.sources[name]?.content;
    if (source == null) throw new Error(`Missing flatten dependency: ${name}`);
    const dependencies = [];
    source = source.replace(/import\s+(?:[^;]*?\s+from\s+)?["']([^"']+)["']\s*;/g, (_, dependency) => {
      const resolved = dependency.startsWith('.')
        ? path.posix.normalize(path.posix.join(path.posix.dirname(name), dependency)) : dependency;
      dependencies.push(resolved);
      return '';
    });
    source = source.replace(/^\s*\/\/ SPDX-License-Identifier:.*$/gm, '')
      .replace(/^\s*pragma solidity[^;]*;/gm, '');
    return dependencies.map(flatten).join('\n') + `\n// File: ${name}\n` + source.trim() + '\n';
  }
  const flattened = '// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\n\n' +
    '// Includes unmodified logic from OpenZeppelin Contracts v5.0.2 (MIT).\n' +
    flatten('contracts/QKIDelegatedMultiHop.sol');
  fs.writeFileSync('QKIDelegatedMultiHop.sol', flattened);
  const check = JSON.parse(solc.compile(JSON.stringify({
    ...input, sources: { 'QKIDelegatedMultiHop.sol': { content: flattened } }
  })));
  const errors = (check.errors || []).filter(e => e.severity === 'error');
  if (errors.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  fs.writeFileSync('build/flattened-standard-input.json', JSON.stringify({
    ...input, sources: { 'QKIDelegatedMultiHop.sol': { content: flattened } }
  }, null, 2));
  const verifiedRouter = '0x3c91FD5247B050A1536F24D012a17a618EEFbfCA';
  function runtimeHash(contract) {
    let runtime = contract.evm.deployedBytecode.object;
    const references = Object.values(contract.evm.deployedBytecode.immutableReferences).flat();
    if (Object.keys(contract.evm.deployedBytecode.immutableReferences).length !== 1) throw new Error('Unexpected immutable layout');
    for (const {start,length} of references) {
      if (length !== 32) throw new Error('Unexpected immutable length');
      runtime = runtime.slice(0,start*2) + verifiedRouter.slice(2).toLowerCase().padStart(64,'0') + runtime.slice((start+length)*2);
    }
    const trailerBytes = parseInt(runtime.slice(-4),16) + 2;
    return keccak256('0x'+runtime.slice(0,-trailerBytes*2));
  }
  const v1Hashes = [artifact, check.contracts['QKIDelegatedMultiHop.sol'].QKIDelegatedMultiHop].map(runtimeHash);
  // Retain the previously published V1 executable identity for existing deployments.
  v1Hashes.push('0x02aaba8eb298aeaab9914ff2abeb60a4bf8e2236bdb4f716e297c0e9869d430a');
  const v2=output.contracts['contracts/QKIDelegatedMultiHopV2.sol'].QKIDelegatedMultiHopV2;
  fs.writeFileSync('build/QKIDelegatedMultiHopV2.abi.json',JSON.stringify(v2.abi,null,2));
  fs.writeFileSync('build/QKIDelegatedMultiHopV2.bin',v2.evm.bytecode.object+'\n');
  fs.writeFileSync('build/QKIDelegatedMultiHopV2.storage-layout.json',JSON.stringify(v2.storageLayout,null,2));
  fs.writeFileSync('build/standard-input-v2.json',JSON.stringify(input,null,2));
  fs.writeFileSync('build/compiler-v2.json',JSON.stringify({version:solc.version(),optimizer:input.settings.optimizer,evmVersion:input.settings.evmVersion,deployedBytecodeBytes:v2.evm.deployedBytecode.object.length/2},null,2));
  visited.clear();
  const flattenedV2='// SPDX-License-Identifier: MIT\npragma solidity 0.8.24;\n\n// Includes unmodified logic from OpenZeppelin Contracts v5.0.2 (MIT).\n'+flatten('contracts/QKIDelegatedMultiHopV2.sol');
  fs.writeFileSync('QKIDelegatedMultiHopV2.sol',flattenedV2);
  const flatInputV2={...input,sources:{'QKIDelegatedMultiHopV2.sol':{content:flattenedV2}}};
  const checkV2=JSON.parse(solc.compile(JSON.stringify(flatInputV2)));
  const errorsV2=(checkV2.errors||[]).filter(e=>e.severity==='error');
  if(errorsV2.length)throw new Error(errorsV2.map(e=>e.formattedMessage).join('\n'));
  fs.writeFileSync('build/flattened-standard-input-v2.json',JSON.stringify(flatInputV2,null,2));
  const v2Hashes=[v2,checkV2.contracts['QKIDelegatedMultiHopV2.sol'].QKIDelegatedMultiHopV2].map(runtimeHash);
  fs.writeFileSync('build/contract-verification.json', JSON.stringify({
    router:verifiedRouter, chainId:20181205,
    currentVersion:2,compiler:solc.version(),runtimeHashes:[...new Set([...v1Hashes,...v2Hashes])],
    v1RuntimeHashes:[...new Set(v1Hashes)],v2RuntimeHashes:[...new Set(v2Hashes)],
    note:'Runtime executable hash with fixed router; compiler CBOR metadata excluded.'
  },null,2));
  console.log(`Compiled V1 and V2, original and flattened, Solidity ${solc.version()} (Paris). Runtime V1 ${artifact.evm.deployedBytecode.object.length/2} bytes; V2 ${v2.evm.deployedBytecode.object.length/2} bytes.`);
  return artifact;
}

if (process.argv[1] === new URL(import.meta.url).pathname) writeArtifacts();
