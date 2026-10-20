// A round is a soft wall-clock budget; an individual sampler cannot be preempted.
export function roundCapacity({waitingUsers,estimatedImageMs=10000,externalQueueDepth=0,budgetMs=30000}){
  if(!waitingUsers)return 0;
  const budget=Math.max(1000,budgetMs/(1+Math.max(0,externalQueueDepth)));
  const cost=Math.max(250,estimatedImageMs);
  return Math.max(1,Math.min(waitingUsers,Math.floor(budget/cost)));
}
export function updateImageEstimate(previousMs,observedMs){
  const sample=Math.max(250,Math.min(1800000,observedMs));
  return previousMs>0?previousMs*.75+sample*.25:sample;
}
