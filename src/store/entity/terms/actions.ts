import { ActionTree } from 'vuex'
import { TermsState } from './types'
import { RootState } from '@/store/types'

import { i18n } from '@/i18n'
import { getLabels, getEntityData } from '@/api/wikidata'

export const actions: ActionTree<TermsState, RootState> = {
  async getLabel({ commit, getters }, entityId, lang?) {
    if (getters.hasEntityLabel(entityId, lang, false)) {
      return getters.getEntityLabel(entityId, lang)
    }

    if (getters.isLabelInflight(entityId, lang)) {
      const loadedTerms = await getters.getLabelPromise(entityId, lang)
      const langCode = lang || i18n.locale
      const theTerms = loadedTerms.get(langCode)

      if (theTerms !== undefined) {
        const label = theTerms.get(entityId)

        if (label !== undefined) {
          return label
        }
      }

      return entityId
    }

    const promise = getLabels([entityId], lang)
    commit('labelsRequested', {
      entities: [entityId],
      lang,
      promise,
    })
    const labels = await promise
    commit('labelsLoaded', labels)

    return getters.getEntityLabel(entityId, lang)
  },
  async requestLabels({ commit, getters }, entityIds, lang?) {
    const missingLabels = []

    for (const entityId of entityIds) {
      if ((!getters.hasEntityLabel(entityId, lang, false) &&
           !getters.isLabelInflight(entityId, lang))) {
        missingLabels.push(entityId)
      }
    }

    const promise = getLabels(missingLabels, lang)
    commit('labelsRequested', {
      entities: missingLabels,
      lang,
      promise,
    })

    await promise
  },
  async getTerms({ commit, getters }, entityId, lang?) {
    if (getters.hasTerms(entityId, lang, false)) {
      return getters.getTerms(entityId, lang)
    }

    if (getters.isTermsInflight(entityId, lang)) {
      const loadedData = await getters.getTermsPromise(entityId, lang)
      const langCode = lang || i18n

      let label = entityId
      let aliases: string[] = []
      let description = ''

      const loadedLabels = loadedData.labels.get(langCode)
      if (loadedLabels !== undefined) {
        const theLabel = loadedLabels.get(entityId)

        if (theLabel !== undefined) {
          label = theLabel
        }
      }

      const loadedAliases = loadedData.aliases.get(langCode)
      if (loadedAliases !== undefined) {
        const theAliases = loadedAliases.get(entityId)

        if (theAliases !== undefined) {
          aliases = theAliases
        }
      }

      const loadedDescriptions = loadedData.descriptions.get(langCode)
      if (loadedDescriptions !== undefined) {
        const theDescription = loadedDescriptions.get(entityId)

        if (theDescription !== undefined) {
          description = theDescription
        }
      }

      return {
        label,
        aliases,
        description,
      }
    }

    const promise = getEntityData(entityId, lang)
    commit('termsRequested', {
      entities: [entityId],
      lang,
      promise,
    })
    const entityData = await promise
    commit('termsLoaded', {
      labels: entityData.labels,
      aliases: entityData.aliases,
      descriptions: entityData.descriptions,
    })

    return getters.getTerms(entityId, lang)
  },
}
