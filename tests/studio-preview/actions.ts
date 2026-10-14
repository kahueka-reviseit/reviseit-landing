export const correctInventoryMarkAction=async()=>({ok:false as const,error:'Preview only: no correction was saved.'});
export const correctInventoryCognitionAction=correctInventoryMarkAction;
export const reviewInventoryAction=async()=>({ok:false as const,error:'Preview only: no checkpoint was approved.'});
export const logout=async()=>{};
export const saveDraftAction=async()=>({ok:false as const,error:'Another editor saved a newer revision. Preview only: no draft was saved.'});
export const discardDraftAction=async()=>({ok:false as const,error:'Preview only: no draft was discarded.'});

export const saveFormDraftAction=saveDraftAction;

export const requestCheckAction=async()=>({ok:false as const,error:'Another editor changed a selected draft. Refresh before checking.'});
export const reviewCheckAction=async()=>({ok:false as const,error:'Drafts or accepted bank changed. A fresh check and review are required.'});
export const prepareIntegrationAction=async()=>({ok:false as const,error:'Preview only: no integration was created.'});
export const authoriseIntegrationAction=async()=>({ok:false as const,error:'Review changed. Preview only: no integration was authorised.'});
export const cancelIntegrationAction=async()=>({ok:false as const,error:'Preview only: no integration was cancelled.'});

export async function requestReleasePreparation(){return {ok:true as const,preparationId:'synthetic'};}
export async function cancelReleasePreparation(){return {ok:true as const};}

export async function stageRelease(){return {ok:true as const};}
export async function reviewRelease(){return {ok:true as const};}
export async function activateRelease(){return {ok:true as const};}
