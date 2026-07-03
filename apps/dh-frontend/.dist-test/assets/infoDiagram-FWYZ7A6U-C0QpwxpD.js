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
import "./chunk-5TONJI2A-B5lwIyWC.js";
import "./chunk-5HE753X5-BVVvvTSk.js";
import "./chunk-U6XO7XAA-BEVahbP9.js";
import "./chunk-JG7HCLWE-DwOB4aY4.js";
import "./chunk-CQNSW5MT-BDuAZ6Y4.js";
import "./chunk-R7FJI6CG-LMHSDAHk.js";
import "./chunk-5FCAYU7R-C0Uc9bU1.js";
import { n as __name } from "./chunk-Y2CYZVJY-DUN_E3Zt.js";
import { c as configureSvgSize } from "./chunk-WYO6CB5R-Cw7oSHEb.js";
import { t as selectSvgElement } from "./chunk-VAUOI2AC-DnuK6HfH.js";
import { n as parse } from "./mermaid-parser.core-CUdtHenI.js";
var parser = { parse: /* @__PURE__ */ __name(async (input) => {
	const ast = await parse("info", input);
	log.debug(ast);
}, "parse") };
var DEFAULT_INFO_DB = { version: "11.16.0" };
var diagram = {
	parser,
	db: { getVersion: /* @__PURE__ */ __name(() => DEFAULT_INFO_DB.version, "getVersion") },
	renderer: { draw: /* @__PURE__ */ __name((text, id, version) => {
		log.debug("rendering info diagram\n" + text);
		const svg = selectSvgElement(id);
		configureSvgSize(svg, 100, 400, true);
		svg.append("g").append("text").attr("x", 100).attr("y", 40).attr("class", "version").attr("font-size", 32).style("text-anchor", "middle").text(`v${version}`);
	}, "draw") }
};
export { diagram };
