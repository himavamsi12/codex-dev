// Design Inspector AI: provider interface for a future vision model.
//
// No provider ships with this version. Until one is registered, asking for an
// AI result fails with the explicit error "provider_not_configured"; nothing
// here fabricates analysis or patches. The manual builder does not use this
// file at all.
//
// To connect a model later, implement the two methods below and register it
// once at startup:
//
//   DesignAIProviders.register({
//     id: 'my-vision-model',
//     async analyzeReference({ referenceImage, targetContext, instructions }) { ... return DesignAnalysis },
//     async generatePatch({ analysis, targetContext, instructions }) { ... return DesignPatch },
//   });
//
// Every patch a provider returns goes through DesignAICore.validatePatch, the
// same gate the manual controls use, so a model can only set allow-listed CSS
// properties on the selected element. It cannot run script or touch markup.
//
// Types (JSDoc, the extension is plain JavaScript):
//
// @typedef {Object} TargetElementContext
//   tag, id, classes[], selector, rect{width,height}, viewport{width,height},
//   text (short excerpt), childCount, html (sanitized, truncated),
//   computed{ property: value }
//
// @typedef {Object} DesignAnalysis            (defined by the provider; opaque to the UI)
//   summary: string, plus any provider-specific fields
//
// @typedef {Object} DesignPatchOperation
//   { op:'set', property, value, breakpoint? } | { op:'remove', property, breakpoint? } | { op:'text', value }
//
// @typedef {Object} DesignPatch
//   { operations: DesignPatchOperation[], notes?: string }
//
// @typedef {Object} DesignGenerationResult
//   { analysis: DesignAnalysis, patch: DesignPatch, provider: string }
(function (root) {
    'use strict';
    if (root.DesignAIProviders) return;
    const Core = root.DesignAICore;

    const unconfigured = {
        id: 'unconfigured',
        configured: false,
        analyzeReference() { return Promise.reject(notConfigured()); },
        generatePatch() { return Promise.reject(notConfigured()); },
    };

    function notConfigured() {
        return new Core.DesignAIError(
            'provider_not_configured',
            'AI design generation is not available: no AI provider is configured in this version. ' +
            'You can still recreate the design with the manual builder, preview it, undo it and export the CSS.'
        );
    }

    let active = unconfigured;

    function register(provider) {
        if (!provider || typeof provider.analyzeReference !== 'function' || typeof provider.generatePatch !== 'function' || typeof provider.id !== 'string') {
            throw new Core.DesignAIError('invalid_provider', 'A provider needs an id, analyzeReference() and generatePatch().');
        }
        active = Object.assign({ configured: true }, provider);
    }

    function unregister() { active = unconfigured; }
    function current() { return active; }
    function isConfigured() { return active.configured === true; }

    /**
     * Reference image + target + instructions -> a validated patch.
     * Rejects with DesignAIError('provider_not_configured') when no provider is
     * registered. A provider's patch that fails validation is rejected, never
     * partially applied.
     */
    async function generateDesign(input) {
        if (!isConfigured()) throw notConfigured();
        if (!input || !input.targetContext) throw new Core.DesignAIError('bad_input', 'Select a target section first.');
        const provider = active;
        let analysis, patch;
        try {
            analysis = await provider.analyzeReference({
                referenceImage: input.referenceImage || null,
                targetContext: input.targetContext,
                instructions: input.instructions || '',
            });
            patch = await provider.generatePatch({
                analysis: analysis,
                targetContext: input.targetContext,
                instructions: input.instructions || '',
            });
        } catch (e) {
            if (e instanceof Core.DesignAIError) throw e;
            throw new Core.DesignAIError('provider_error', 'The AI provider failed: ' + String((e && e.message) || e).slice(0, 200));
        }
        const checked = Core.validatePatch(patch);
        if (!checked.ok) {
            throw new Core.DesignAIError('invalid_patch', 'The provider returned a patch that failed validation: ' + checked.errors.slice(0, 3).join(' '));
        }
        return { analysis: analysis, patch: { operations: checked.operations, notes: patch.notes }, provider: provider.id };
    }

    root.DesignAIProviders = { register, unregister, current, isConfigured, generateDesign };
})(typeof self !== 'undefined' ? self : this);
