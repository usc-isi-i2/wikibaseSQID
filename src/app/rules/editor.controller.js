define(['rules/rules.module',
		'i18n/i18n.service',
		'util/wikidataapi.service',
		'util/dataFormatter.service',
		'rules/labels.service',
		'rules/parser.service'
	   ],
function() {
	angular.module('rules').controller('EditorController',
	['$scope', '$route', '$sce', '$translate', '$q', '$location',
	'i18n', 'wikidataapi', 'dataFormatter', 'labels', 'parser', 'provider',
	function($scope, $route, $sce, $translate, $q, $location, i18n, wikidataapi, dataFormatter, labels, parser, provider) {

		var PREFIX = '{{User:Akorenchkin/Rule|';
		var SUFFIX = '}}';
		var RULE_RE = /({{User:Akorenchkin\/Rule\|)(.*?)(}})/gm;
		var COMPONENT_RE = /(^|\|)([^=]+)=(.*?)(?=(\||$))/gm;
		var KEYS = ['rule', 'description', 'type'];
		var BACKLINK = '{{User:Akorenchkin/Rules list}}';

		$scope.body = '';
		$scope.head = '';
		$scope.rule = undefined;
		$scope.error = undefined;

		var wantNewRule = ($location.path().endsWith === '/new');

		if (!wantNewRule) {
			var search = $location.search();
			provider.getDynamicRule(
				search.origin,
				search.offset
			).then(function(rule) {
				setRule(rule);

				return wikidataapi.getPageContent(search.origin)
					.then(function(page) {
						setRule(extractRule(page, search.offset));
				});
			});
		}

		$scope.$parent.addOrEdit = (wantNewRule
									? 'add'
									: 'edit');

		$scope.renderRule = function() {
			var rule = undefined;
			var input = $scope.body + ' -> ' + $scope.head;

			try {
				rule = parser.parse(input, false);
			} catch(err) {
				// parse error, build an error message
				$scope.error = err;
			}

			if (angular.isUndefined(rule)) {
				// no new rule, so we're done here
				return $q.resolve();
			}

			// got a rule, so clear the error message
			$scope.error = undefined;

			// fetch all the relevant labels, then redraw the rule
			return labels.labelPromiseForRule(
					rule
			).then(function() {
				$scope.rule = rule;
			});
		};

		function setRule(rule) {
			if (angular.isUndefined(rule)) {
				// rule does not exist, force new
				wantNewRule = true;
				return;
			}

			var components = rule.rule.split('->');
			$scope.body = components[0];
			$scope.head = components[1];
			$scope.desc = rule.desc;
			$scope.kind = rule.kind;
			$scope.rule = rule;

			$scope.renderRule();
		}

		function extractRule(content, offset) {
			if (angular.isUndefined(content) ||
				angular.isUndefined(content.pages) ||
				Object.keys(content.pages).length === 0) {
				return undefined;
			}

			var keys = Object.keys(content.pages);
			var page = content.pages[keys[0]];

			if (angular.isUndefined(page) ||
				angular.isUndefined(page.revisions) ||
				angular.isUndefined(page.revisions[0]) ||
				angular.isUndefined(page.revisions[0]['*'])) {
				return undefined;
			}

			var text = page.revisions[0]['*'];
			var fragment = RULE_RE.exec(text);

			for (var i = 0; i < offset; ++i) {
				fragment = RULE_RE.exec(text);
			}

			var rule = {};
			var match = null;

			while ((match = COMPONENT_RE.exec(fragment[2])) !== null) {
				rule[match[2]] = match[3];
				rule.origin = page.title;
				rule.offset = offset;
			}

			rule.prefix = text.substr(0, fragment.index);
			rule.suffix = text.substr(fragment.index + fragment[0].length);

			if (!('type' in rule)) {
				rule.type = 'materialisable';
			}

			// handle naming differences
			rule.kind = rule.type;
			rule.desc = rule.description;

			return rule;
		}

		function generateWikitext(rule) {
			// handle naming differences
			rule.type = rule.kind;
			rule.description = rule.desc;

			var text = ('prefix' in rule
						? rule.prefix
						: '');

			text += PREFIX;
			var first = true;

			for (var key in KEYS) {
				text += ((!first)
						 ? '|'
						 : '') + KEYS[key] + '=' + rule[KEYS[key]];
				first = false;
			}

			text += SUFFIX;

			if ('suffix' in rule) {
				text += rule.suffix;
			}

			if (text.indexOf(BACKLINK) === -1) {
				text += '\n\n' + BACKLINK;
			}

			return text;
		}

		return {
			extractRule: extractRule,
			generateWikitext: generateWikitext
		};
	}]);

	return {};
});
