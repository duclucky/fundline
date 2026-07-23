"use strict";

async function executeWorkflowDefinition(options) {
  const def = options.def;
  const tierDef = options.tierDef;
  const finalModelId = options.finalModelId || "";
  const input = options.input || {};
  const progress = typeof options.onProgress === "function" ? options.onProgress : () => {};

  if (def.type === "cvgig") {
    const result = await options.executors.cvGig.runCvGigWorkflow({
      input: options.query,
      topGigs: 8,
      remoteOnly: !!input.remoteOnly,
      profileModel: tierDef.models.FAST,
      cvModel: tierDef.models.STRONG,
      rankModel: finalModelId || tierDef.models.STRONG,
      groupRatio: options.groupRatio,
      jsearchKey: options.jsearchKey,
      jsearchAvailable: options.jsearchAvailable,
      callModel: options.callModel,
      fetchGigs: options.fetchGigs,
      onProgress: progress,
    });
    if (result.meta
      && result.meta.sourceCounts
      && Object.hasOwn(result.meta.sourceCounts, "JSearch")
      && typeof options.onJsearchUsed === "function") {
      options.onJsearchUsed();
    }
    return result;
  }

  if (def.type === "cryptodd") {
    return options.executors.cryptoDd.runCryptoDdWorkflow({
      input: options.query,
      chain: input.chain,
      address: input.token || input.address,
      intakeModel: tierDef.models.FAST,
      newsModel: tierDef.models.FAST,
      writerModel: finalModelId || tierDef.models.STRONG,
      verifierModel: tierDef.models.VERIFY || tierDef.models.STRONG,
      groupRatio: options.groupRatio,
      callModel: options.callModel,
      fetchData: options.fetchData,
      searchToken: options.searchToken,
      searchWeb: options.cryptoSearchWeb,
      onProgress: progress,
    });
  }

  if (def.type === "docgen") {
    const result = await options.executors.docGen.runDocGenWorkflow({
      docType: def.docType || input.docType || "proposal",
      input: options.query,
      brief: input.brief && typeof input.brief === "object" ? input.brief : {},
      research: !!input.research,
      format: "pdf",
      writerModel: finalModelId || tierDef.models.STRONG,
      groupRatio: options.groupRatio,
      today: options.today,
      callModel: options.callModel,
      searchWeb: options.searchWeb,
      onProgress: progress,
    });
    if (result.file && result.file.base64 && typeof options.persistDocument === "function") {
      result.file = options.persistDocument(result.file);
    }
    return result;
  }

  return options.executors.engine.runWorkflowGraph({
    graph: options.graph,
    tierModels: tierDef.models,
    finalModelId,
    input: options.query,
    mode: options.mode,
    pastedSources: options.pastedSources,
    searchWeb: options.searchWeb,
    groupRatio: options.groupRatio,
    today: options.today,
    callModel: options.callModel,
    onProgress: progress,
  });
}

module.exports = { executeWorkflowDefinition };
