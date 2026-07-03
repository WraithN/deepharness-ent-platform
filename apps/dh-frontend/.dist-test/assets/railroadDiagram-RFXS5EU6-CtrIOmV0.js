import { n as log } from "./src-4Uq4GVbL.js";
import "./chunk-KEIR6QF5-BkcPtfg-.js";
import "./chunk-MOZMSUNE-520Hlcxh.js";
import "./chunk-OSBZ3O6U-1d1kYC0D.js";
import "./chunk-5JV3BV7I-DgR5Z_Po.js";
import "./chunk-CYSBUYHQ-8bPoWV9O.js";
import "./chunk-BIQX33UG-CCQKgt9q.js";
import "./chunk-EMLP6XTP-BFH2M-Xk.js";
import "./chunk-YOTPTUD7-CgjYUI6o.js";
import "./chunk-QBLGF6JB-BkHI-_vo.js";
import { n as createRailroadServices } from "./chunk-5TONJI2A-B5lwIyWC.js";
import "./chunk-5HE753X5-BVVvvTSk.js";
import "./chunk-U6XO7XAA-BEVahbP9.js";
import "./chunk-JG7HCLWE-DwOB4aY4.js";
import "./chunk-CQNSW5MT-BDuAZ6Y4.js";
import "./chunk-R7FJI6CG-LMHSDAHk.js";
import "./chunk-5FCAYU7R-C0Uc9bU1.js";
import { n as __name } from "./chunk-Y2CYZVJY-DUN_E3Zt.js";
import "./chunk-WYO6CB5R-Cw7oSHEb.js";
import "./chunk-VAUOI2AC-DnuK6HfH.js";
import { n as getStyles, r as renderer, t as db } from "./chunk-MOJQB5TN-CXvDpauc.js";
import { t as populateCommonDb } from "./chunk-JWPE2WC7-DafgxSHc.js";
import { t as MermaidParseError } from "./mermaid-parser.core-CUdtHenI.js";
var langiumParser = createRailroadServices().Railroad.parser.LangiumParser;
var transformExpression = /* @__PURE__ */ __name((expr) => {
	switch (expr.$type) {
		case "RailroadTerminalExpr": return {
			type: "terminal",
			value: expr.value
		};
		case "RailroadNonTerminalExpr": return {
			type: "nonterminal",
			name: expr.name
		};
		case "RailroadSpecialExpr": return {
			type: "special",
			text: expr.text
		};
		case "RailroadSequenceExpr": {
			const elements = expr.elements.map(transformExpression);
			return elements.length === 1 ? elements[0] : {
				type: "sequence",
				elements
			};
		}
		case "RailroadChoiceExpr": {
			const alternatives = expr.alternatives.map(transformExpression);
			return alternatives.length === 1 ? alternatives[0] : {
				type: "choice",
				alternatives
			};
		}
		case "RailroadOptionalExpr": return {
			type: "optional",
			element: transformExpression(expr.element)
		};
		case "RailroadOneOrMoreExpr": return {
			type: "repetition",
			element: transformExpression(expr.element),
			min: 1,
			max: Infinity
		};
		case "RailroadZeroOrMoreExpr": return {
			type: "repetition",
			element: transformExpression(expr.element),
			min: 0,
			max: Infinity
		};
		default: throw new Error(`Unsupported railroad expression: ${expr.$type}`);
	}
}, "transformExpression");
var transformRule = /* @__PURE__ */ __name((rule) => {
	return {
		name: rule.name,
		definition: transformExpression(rule.definition)
	};
}, "transformRule");
var populateDb = /* @__PURE__ */ __name((ast) => {
	populateCommonDb(ast, db);
	if (ast.title) db.setTitle(ast.title);
	ast.rules.map((rule) => db.addRule(transformRule(rule)));
}, "populateDb");
var diagram = {
	parser: {
		parse: /* @__PURE__ */ __name((input) => {
			db.clear();
			log.debug("[Railroad Parser] Starting Langium parse");
			const result = langiumParser.parse(input);
			if (result.lexerErrors.length > 0 || result.parserErrors.length > 0) throw new MermaidParseError(result);
			const ast = result.value;
			log.debug("[Railroad Parser] Parsed rules:", ast.rules.length);
			populateDb(ast);
			log.debug("[Railroad Parser] Parse complete");
		}, "parse"),
		parser: { yy: db }
	},
	db,
	renderer,
	styles: getStyles
};
export { diagram };
