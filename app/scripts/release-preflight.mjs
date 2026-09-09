#!/usr/bin/env node
import {assertCleanAndCurrent,assertGitHubReleaseReady,assertRemoteMigrationsCurrent,reportError} from './release-common.mjs';

try{
  const git=assertCleanAndCurrent();
  const github=assertGitHubReleaseReady(git.head);
  const migrations=assertRemoteMigrationsCurrent();
  console.log(JSON.stringify({ok:true,git,github,migrations:{local:migrations.local,applied:migrations.applied}},null,2));
}catch(error){reportError(error);}
