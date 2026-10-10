// Read-only public registry lookup; no credentials or project data are transmitted.
async function digest(repo,tag){
 const {execFileSync}=require('node:child_process');
 const token=JSON.parse(execFileSync('curl',['--retry','2','--max-time','20','-fsS',`https://auth.docker.io/token?service=registry.docker.io&scope=repository:${repo}:pull`],{encoding:'utf8'}));
 const headers=execFileSync('curl',['--retry','2','--max-time','20','-fsSI','-H',`Authorization: Bearer ${token.token}`,'-H','Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json',`https://registry-1.docker.io/v2/${repo}/manifests/${tag}`],{encoding:'utf8'});
 const hash=headers.match(/docker-content-digest:\s*(sha256:[a-f0-9]{64})/i)?.[1];if(!hash)throw new Error('Missing image digest');console.log(`${repo}:${tag}@${hash}`);
}
(async()=>{for(const [repo,tag]of [['library/node','24-bookworm-slim'],['nginxinc/nginx-unprivileged','stable-alpine'],['library/python','3.12-slim-bookworm']])await digest(repo,tag)})().catch(e=>{console.error(e.message);process.exitCode=1});
