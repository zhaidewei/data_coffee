#!/usr/bin/env node
import {collectReadback,parseReadbackArgs,reportError} from './release-common.mjs';

try{
  const result=await collectReadback(parseReadbackArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result,null,2));
}catch(error){reportError(error);}
