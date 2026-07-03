const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/info-DKCQHKI2-0m3wtFfp.js","assets/chunk-BIQX33UG-CCQKgt9q.js","assets/chunk-KEIR6QF5-BkcPtfg-.js","assets/packet-7NZHBO7P-ZqqohKiN.js","assets/chunk-EMLP6XTP-BFH2M-Xk.js","assets/pie-RZYD4A2V-BiEwsjmB.js","assets/chunk-YOTPTUD7-CgjYUI6o.js","assets/treeView-QDETBFTQ-DZEM6ds1.js","assets/chunk-CQNSW5MT-BDuAZ6Y4.js","assets/architecture-TIHT7OUA-CVni6Dp6.js","assets/chunk-MOZMSUNE-520Hlcxh.js","assets/gitGraph-TEB2WS4Q-CWRpSyBk.js","assets/chunk-CYSBUYHQ-8bPoWV9O.js","assets/eventmodeling-45OFAUF4-BNXRAr1q.js","assets/chunk-5JV3BV7I-DgR5Z_Po.js","assets/radar-I7S5WNFK-C2tWsDGg.js","assets/chunk-QBLGF6JB-BkHI-_vo.js","assets/railroad-3IZDKUUU-BMUVWsN1.js","assets/chunk-5TONJI2A-B5lwIyWC.js","assets/railroad-ebnf-EBAXGLYW-DJVSwJgK.js","assets/chunk-U6XO7XAA-BEVahbP9.js","assets/railroad-abnf-AHOZXSZD-BRuao2G5.js","assets/chunk-5HE753X5-BVVvvTSk.js","assets/railroad-peg-LSFZ7HO6-CY2SFH-8.js","assets/chunk-JG7HCLWE-DwOB4aY4.js","assets/treemap-6X3UGDF4-0hWjhkXF.js","assets/chunk-R7FJI6CG-LMHSDAHk.js","assets/wardley-OPB4EBWU-DXJsoPLD.js","assets/chunk-5FCAYU7R-C0Uc9bU1.js","assets/cynefin-VYW2F7L2-BI51xcAI.js","assets/chunk-OSBZ3O6U-1d1kYC0D.js"])))=>i.map(i=>d[i]);
import { dt as __vitePreload } from "./index-DbiBhjOw.js";
import { x as __name } from "./chunk-KEIR6QF5-BkcPtfg-.js";
var parsers = {};
var initializers = {
	info: /* @__PURE__ */ __name(async () => {
		const { createInfoServices: createInfoServices2 } = await __vitePreload(async () => {
			const { createInfoServices: createInfoServices2$1 } = await import("./info-DKCQHKI2-0m3wtFfp.js");
			return { createInfoServices: createInfoServices2$1 };
		}, __vite__mapDeps([0,1,2]));
		parsers.info = createInfoServices2().Info.parser.LangiumParser;
	}, "info"),
	packet: /* @__PURE__ */ __name(async () => {
		const { createPacketServices: createPacketServices2 } = await __vitePreload(async () => {
			const { createPacketServices: createPacketServices2$1 } = await import("./packet-7NZHBO7P-ZqqohKiN.js");
			return { createPacketServices: createPacketServices2$1 };
		}, __vite__mapDeps([3,4,2]));
		parsers.packet = createPacketServices2().Packet.parser.LangiumParser;
	}, "packet"),
	pie: /* @__PURE__ */ __name(async () => {
		const { createPieServices: createPieServices2 } = await __vitePreload(async () => {
			const { createPieServices: createPieServices2$1 } = await import("./pie-RZYD4A2V-BiEwsjmB.js");
			return { createPieServices: createPieServices2$1 };
		}, __vite__mapDeps([5,2,6]));
		parsers.pie = createPieServices2().Pie.parser.LangiumParser;
	}, "pie"),
	treeView: /* @__PURE__ */ __name(async () => {
		const { createTreeViewServices: createTreeViewServices2 } = await __vitePreload(async () => {
			const { createTreeViewServices: createTreeViewServices2$1 } = await import("./treeView-QDETBFTQ-DZEM6ds1.js");
			return { createTreeViewServices: createTreeViewServices2$1 };
		}, __vite__mapDeps([7,8,2]));
		parsers.treeView = createTreeViewServices2().TreeView.parser.LangiumParser;
	}, "treeView"),
	architecture: /* @__PURE__ */ __name(async () => {
		const { createArchitectureServices: createArchitectureServices2 } = await __vitePreload(async () => {
			const { createArchitectureServices: createArchitectureServices2$1 } = await import("./architecture-TIHT7OUA-CVni6Dp6.js");
			return { createArchitectureServices: createArchitectureServices2$1 };
		}, __vite__mapDeps([9,2,10]));
		parsers.architecture = createArchitectureServices2().Architecture.parser.LangiumParser;
	}, "architecture"),
	gitGraph: /* @__PURE__ */ __name(async () => {
		const { createGitGraphServices: createGitGraphServices2 } = await __vitePreload(async () => {
			const { createGitGraphServices: createGitGraphServices2$1 } = await import("./gitGraph-TEB2WS4Q-CWRpSyBk.js");
			return { createGitGraphServices: createGitGraphServices2$1 };
		}, __vite__mapDeps([11,12,2]));
		parsers.gitGraph = createGitGraphServices2().GitGraph.parser.LangiumParser;
	}, "gitGraph"),
	eventmodeling: /* @__PURE__ */ __name(async () => {
		const { createEventModelingServices: createEventModelingServices2 } = await __vitePreload(async () => {
			const { createEventModelingServices: createEventModelingServices2$1 } = await import("./eventmodeling-45OFAUF4-BNXRAr1q.js");
			return { createEventModelingServices: createEventModelingServices2$1 };
		}, __vite__mapDeps([13,14,2]));
		parsers.eventmodeling = createEventModelingServices2().EventModel.parser.LangiumParser;
	}, "eventmodeling"),
	radar: /* @__PURE__ */ __name(async () => {
		const { createRadarServices: createRadarServices2 } = await __vitePreload(async () => {
			const { createRadarServices: createRadarServices2$1 } = await import("./radar-I7S5WNFK-C2tWsDGg.js");
			return { createRadarServices: createRadarServices2$1 };
		}, __vite__mapDeps([15,2,16]));
		parsers.radar = createRadarServices2().Radar.parser.LangiumParser;
	}, "radar"),
	railroad: /* @__PURE__ */ __name(async () => {
		const { createRailroadServices: createRailroadServices2 } = await __vitePreload(async () => {
			const { createRailroadServices: createRailroadServices2$1 } = await import("./railroad-3IZDKUUU-BMUVWsN1.js");
			return { createRailroadServices: createRailroadServices2$1 };
		}, __vite__mapDeps([17,18,2]));
		parsers.railroad = createRailroadServices2().Railroad.parser.LangiumParser;
	}, "railroad"),
	railroadEbnf: /* @__PURE__ */ __name(async () => {
		const { createRailroadEbnfServices: createRailroadEbnfServices2 } = await __vitePreload(async () => {
			const { createRailroadEbnfServices: createRailroadEbnfServices2$1 } = await import("./railroad-ebnf-EBAXGLYW-DJVSwJgK.js");
			return { createRailroadEbnfServices: createRailroadEbnfServices2$1 };
		}, __vite__mapDeps([19,2,20]));
		parsers.railroadEbnf = createRailroadEbnfServices2().RailroadEbnf.parser.LangiumParser;
	}, "railroadEbnf"),
	railroadAbnf: /* @__PURE__ */ __name(async () => {
		const { createRailroadAbnfServices: createRailroadAbnfServices2 } = await __vitePreload(async () => {
			const { createRailroadAbnfServices: createRailroadAbnfServices2$1 } = await import("./railroad-abnf-AHOZXSZD-BRuao2G5.js");
			return { createRailroadAbnfServices: createRailroadAbnfServices2$1 };
		}, __vite__mapDeps([21,22,2]));
		parsers.railroadAbnf = createRailroadAbnfServices2().RailroadAbnf.parser.LangiumParser;
	}, "railroadAbnf"),
	railroadPeg: /* @__PURE__ */ __name(async () => {
		const { createRailroadPegServices: createRailroadPegServices2 } = await __vitePreload(async () => {
			const { createRailroadPegServices: createRailroadPegServices2$1 } = await import("./railroad-peg-LSFZ7HO6-CY2SFH-8.js");
			return { createRailroadPegServices: createRailroadPegServices2$1 };
		}, __vite__mapDeps([23,24,2]));
		parsers.railroadPeg = createRailroadPegServices2().RailroadPeg.parser.LangiumParser;
	}, "railroadPeg"),
	treemap: /* @__PURE__ */ __name(async () => {
		const { createTreemapServices: createTreemapServices2 } = await __vitePreload(async () => {
			const { createTreemapServices: createTreemapServices2$1 } = await import("./treemap-6X3UGDF4-0hWjhkXF.js");
			return { createTreemapServices: createTreemapServices2$1 };
		}, __vite__mapDeps([25,2,26]));
		parsers.treemap = createTreemapServices2().Treemap.parser.LangiumParser;
	}, "treemap"),
	wardley: /* @__PURE__ */ __name(async () => {
		const { createWardleyServices: createWardleyServices2 } = await __vitePreload(async () => {
			const { createWardleyServices: createWardleyServices2$1 } = await import("./wardley-OPB4EBWU-DXJsoPLD.js");
			return { createWardleyServices: createWardleyServices2$1 };
		}, __vite__mapDeps([27,28,2]));
		parsers.wardley = createWardleyServices2().Wardley.parser.LangiumParser;
	}, "wardley"),
	cynefin: /* @__PURE__ */ __name(async () => {
		const { createCynefinServices: createCynefinServices2 } = await __vitePreload(async () => {
			const { createCynefinServices: createCynefinServices2$1 } = await import("./cynefin-VYW2F7L2-BI51xcAI.js");
			return { createCynefinServices: createCynefinServices2$1 };
		}, __vite__mapDeps([29,2,30]));
		parsers.cynefin = createCynefinServices2().Cynefin.parser.LangiumParser;
	}, "cynefin")
};
async function parse(diagramType, text) {
	const initializer = initializers[diagramType];
	if (!initializer) throw new Error(`Unknown diagram type: ${diagramType}`);
	if (!parsers[diagramType]) await initializer();
	const result = parsers[diagramType].parse(text);
	if (result.lexerErrors.length > 0 || result.parserErrors.length > 0) throw new MermaidParseError(result);
	return result.value;
}
__name(parse, "parse");
var MermaidParseError = class extends Error {
	constructor(result) {
		const lexerErrors = result.lexerErrors.map((err) => {
			return `Lexer error on line ${err.line !== void 0 && !isNaN(err.line) ? err.line : "?"}, column ${err.column !== void 0 && !isNaN(err.column) ? err.column : "?"}: ${err.message}`;
		}).join("\n");
		const parserErrors = result.parserErrors.map((err) => {
			return `Parse error on line ${err.token.startLine !== void 0 && !isNaN(err.token.startLine) ? err.token.startLine : "?"}, column ${err.token.startColumn !== void 0 && !isNaN(err.token.startColumn) ? err.token.startColumn : "?"}: ${err.message}`;
		}).join("\n");
		super(`Parsing failed: ${lexerErrors} ${parserErrors}`);
		this.result = result;
	}
	static #_ = __name(this, "MermaidParseError");
};
export { parse as n, MermaidParseError as t };
