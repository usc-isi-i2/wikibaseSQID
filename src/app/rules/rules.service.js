//////// Module Definition ////////////
define([
    'rules/rules.module',
    'rules/parser.service',
    'rules/matcher.service',
    'rules/provider.service',
    'rules/instantiator.service',
    'util/util.service',
    'util/sparql.service',
    'i18n/i18n.service'
], function() {
    angular.module('rules').factory('rules',
    ['$q', '$log', '$translate', 'sparql', 'i18n', 'util', 'entitydata', 'wikidataapi',
    'matcher', 'provider', 'instantiator',
     function($q, $log, $translate, sparql, i18n, util, entitydata, wikidataapi,
             matcher, provider, instantiator) {
        function getStatements(entityData, entityInData, itemId) {
            var promise = entityData.waitForPropertyLabels()
                .then(function() {
                    return entityInData.waitForPropertyLabels();
                }).then(function(linkText) {
                    var queries = [];
                    var requests = [];

                    var candidateRules = provider.getRules()
                        .filter(matcher.couldMatch(
                            entityData.statements,
                            entityInData.statements,
                            itemId));

                    angular.forEach(candidateRules, function(rule) {
                        var subject = rule.head.arguments[0].name;
                        var binding = {};
                        binding[subject] = { id: itemId,
                                             name: subject,
                                             outbound: entityData,
                                             inbound: entityInData
                                           };

                        queries.push(matcher.getInstanceCandidatesQuery(
                            rule,
                            binding));
                    });

                    return queries;
                }).then(function(queries) {
                    return { queries: queries,
                             linkText: $translate('RULES.EXPLAIN')};
                }).then(function(data) {
                    var requests = [];
                    var statements = [];
                    var queries = data.queries;
                    var linkText = data.linkText;

                    angular.forEach(queries, function(query) {
                        var request = sparql.getQueryRequest(query.query);
                        query.request = request.then(function(sparqlResults) {
                            // iterate over result instances
                            angular.forEach(sparqlResults.results, function(sparqlResult) {
                                // augment bindings with results from SPARQL
                                query.bindings = instantiator.augmentBindingsWithSPARQLResult(
                                    query.bindings,
                                    sparqlResult
                                );

                                if (sparqlResult.length === 0) {
                                    return; // no results here, move along
                                }

                                // find claims we need to retrieve
                                var claims = Object.keys(query.bindings)
                                    .filter(function(binding) {
                                        return ((query.bindings[binding].type ===
                                                 'set-variable') &&
                                                'id' in query.bindings[binding]);
                                    })
                                    .map(function(binding) {
                                        return query.bindings[binding].id;
                                    });

                                wikidataapi.getClaims(claims).then(function(apiResult) {
                                    query.bindings = instantiator.augmentBindingsWithAPIResult(
                                        query.bindings,
                                        apiResult
                                    );

                                 var instance = matcher.verifyCandidateInstance(query);
                                    if (angular.isDefined(instance)) {
                                        var statement = instantiator.instantiateRuleHead(instance, linkText);

                                        angular.forEach(statement, function(snak, property) {
                                            if ((!(property in statements))) {
                                                statements[property] = [];
                                            }

                                            var existing = entityData.statements[property];
                                            var equivalent = entitydata
                                                .determineEquivalentStatements(existing,
                                                                               snak[0]);

                                            if(equivalent.length === 0) {
                                                statements[property] = statements[property].concat(snak);
                                            }
                                        });
                                    }
                                });
                            });
                        });

                    requests.push(query);
                });

                return $q.all(requests.map(function(query) {
                    return query.request;
                })).then(function(results) {
                    var requests = { propertyIds: [],
                                     entityIds: [],
                                     results: results
                                   };
                    var num = 0;

                    angular.forEach(statements, function(statement, group) {
                        angular.forEach(statement, function(snak, property) {
                            statements[group][property].id = ('sqid-inference-' + (++num));
                            if (!(property in requests.propertyIds) &&
                                (property.length > 0) &&
                                (property.substring(1) === 'P')) {
                                requests.propertyIds.push(property);
                            }

                            if (('mainsnak' in snak) &&
                                (snak.mainsnak.snaktype === 'value') &&
                                (snak.mainsnak.datatype === 'wikibase-item') &&
                                (snak.mainsnak.datavalue.type === 'wikibase-entityid')) {
                                if (snak.mainsnak.datavalue.value['entity-type'] === 'item') {
                                    var id = 'Q' + snak.mainsnak.datavalue.value['numeric-id'];
                                    if (!(id in requests.entityIds)) {
                                        requests.entityIds.push(id);
                                    }
                                } else {
                                    var id = 'P' + snak.mainsnak.datavalue.value['numeric-id'];
                                    if (!(id in requests.propertyIds)) {
                                        requests.propertyIds.push(id);
                                    }
                                }
                            }

                            angular.forEach(snak.qualifiers, function(qualifier, property) {
                                if (!(property in requests.propertyIds)) {
                                    requests.propertyIds.push(property);
                                }

                                angular.forEach(qualifier, function(snak) {
                                    if ((snak.snaktype === 'value') &&
                                        (snak.datatype === 'wikibase-item') &&
                                        (snak.datavalue.type === 'wikibase-entityid')) {
                                        if (snak.datavalue.value['entity-type'] === 'item') {
                                            var id = 'Q' + snak.datavalue.value['numeric-id'];
                                            if (!(id in requests.entityIds)) {
                                                requests.entityIds.push(id);
                                            }
                                        } else {
                                            var id = 'P' + snak.datavalue.value['numeric-id'];
                                            if (!(id in requests.propertyIds)) {
                                                requests.propertyIds.push(id);
                                            }
                                        }
                                    }
                                });
                            });
                        });
                    });

                    return requests;
                }).then(function(requests) {
                    return { requests: requests,
                             statements: statements
                           };
                });
            });

            var propertyLabels = promise.then(function(data) {
                return i18n.waitForPropertyLabels(util.unionArrays(
                    data.requests.propertyIds,
                    [])).then(function() {
                        return data;
                    });
            });

            var terms = propertyLabels.then(function(data) {
                return i18n.waitForTerms(util.unionArrays(
                    data.requests.entityIds,
                    []));
            });

            return {
                statementsPromise: promise,
                waitForPropertyLabels: function() { return propertyLabels; } ,
                waitForTerms: function() { return terms; }
            };
        }

        return {
            getStatements: getStatements
        };
}]);

return {}; }); // module definition end
