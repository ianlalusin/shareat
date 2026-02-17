#!/usr/bin/env bash
set -euo pipefail
firebase apphosting:secrets:access GEMINI_API_KEY | node -e '
let s="";
process.stdin.on("data",d=>s+=d);
process.stdin.on("end",()=>{
  s=s.trim();
  console.log("hasKey",!!s,"fingerprint",s.slice(0,4)+"..."+s.slice(-4));
});
'