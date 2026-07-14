// Ghidra headless post-script. Caller-controlled scripts and source text are never accepted.
import java.io.FileWriter;
import java.util.*;
import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.symbol.Symbol;

public class UniversalEvidenceExporter extends GhidraScript {
  private static final int MAX_ITEMS = 10000;
  private static String text(Object value) { return value == null ? null : String.valueOf(value); }

  @Override
  public void run() throws Exception {
    String[] args = getScriptArgs();
    if (args.length != 3) throw new IllegalArgumentException("exporter_arguments_invalid");
    String output = args[0];
    if (!output.startsWith("/work/")) throw new IllegalArgumentException("output_outside_workdir");
    int maxDecompile = Math.max(0, Math.min(50, Integer.parseInt(args[1])));
    boolean decompile = Boolean.parseBoolean(args[2]);
    Map<String,Object> root = new LinkedHashMap<>();
    root.put("schema_version", "universal_software_evidence_v1");
    root.put("network_access", "denied");
    root.put("format", currentProgram.getExecutableFormat());
    root.put("language", currentProgram.getLanguageID().toString());
    root.put("compiler", currentProgram.getCompilerSpec().getCompilerSpecID().toString());
    root.put("image_base", text(currentProgram.getImageBase()));

    List<Map<String,Object>> sections = new ArrayList<>();
    for (MemoryBlock block : currentProgram.getMemory().getBlocks()) {
      Map<String,Object> item = new LinkedHashMap<>();
      item.put("name", block.getName()); item.put("start", text(block.getStart())); item.put("end", text(block.getEnd()));
      item.put("size", block.getSize()); item.put("read", block.isRead()); item.put("write", block.isWrite()); item.put("execute", block.isExecute());
      sections.add(item); if (sections.size() >= MAX_ITEMS) break;
    }
    root.put("sections", sections);

    List<Map<String,Object>> symbols = new ArrayList<>();
    Iterator<Symbol> symbolIterator = currentProgram.getSymbolTable().getAllSymbols(true);
    while (symbolIterator.hasNext() && symbols.size() < MAX_ITEMS) {
      Symbol symbol = symbolIterator.next();
      Map<String,Object> item = new LinkedHashMap<>(); item.put("name", symbol.getName()); item.put("address", text(symbol.getAddress())); item.put("type", symbol.getSymbolType().toString()); item.put("external", symbol.isExternal());
      symbols.add(item);
    }
    root.put("symbols", symbols);

    List<Map<String,Object>> imports = new ArrayList<>();
    Iterator<Symbol> importIterator = currentProgram.getSymbolTable().getExternalSymbols();
    while (importIterator.hasNext() && imports.size() < MAX_ITEMS) {
      Symbol symbol = importIterator.next();
      Map<String,Object> item = new LinkedHashMap<>(); item.put("name", symbol.getName()); item.put("address", text(symbol.getAddress())); item.put("type", symbol.getSymbolType().toString());
      imports.add(item);
    }
    root.put("imports", imports);

    List<Map<String,Object>> exports = new ArrayList<>();
    AddressIterator exportIterator = currentProgram.getSymbolTable().getExternalEntryPointIterator();
    while (exportIterator.hasNext() && exports.size() < MAX_ITEMS) {
      Address address = exportIterator.next(); Symbol symbol = currentProgram.getSymbolTable().getPrimarySymbol(address);
      Map<String,Object> item = new LinkedHashMap<>(); item.put("name", symbol == null ? null : symbol.getName()); item.put("address", text(address));
      exports.add(item);
    }
    root.put("exports", exports);

    List<Map<String,Object>> functions = new ArrayList<>();
    List<Map<String,Object>> references = new ArrayList<>();
    List<Map<String,Object>> callGraph = new ArrayList<>();
    List<Map<String,Object>> decompilation = new ArrayList<>();
    DecompInterface decompiler = new DecompInterface();
    decompiler.openProgram(currentProgram);
    int decompiled = 0;
    FunctionIterator iterator = currentProgram.getFunctionManager().getFunctions(true);
    while (iterator.hasNext() && functions.size() < MAX_ITEMS) {
      Function function = iterator.next();
      Map<String,Object> item = new LinkedHashMap<>(); item.put("name", function.getName()); item.put("entry", text(function.getEntryPoint())); item.put("external", function.isExternal()); item.put("thunk", function.isThunk());
      functions.add(item);
      ReferenceIterator refs = currentProgram.getReferenceManager().getReferencesFrom(function.getEntryPoint());
      while (refs.hasNext() && references.size() < MAX_ITEMS) {
        Reference ref = refs.next(); Address to = ref.getToAddress();
        Map<String,Object> edge = new LinkedHashMap<>(); edge.put("from", text(ref.getFromAddress())); edge.put("to", text(to)); edge.put("type", ref.getReferenceType().toString()); references.add(edge);
        Function target = currentProgram.getFunctionManager().getFunctionContaining(to);
        if (target != null && ref.getReferenceType().isCall() && callGraph.size() < MAX_ITEMS) {
          Map<String,Object> call = new LinkedHashMap<>(); call.put("caller", function.getName()); call.put("callee", target.getName()); call.put("from", text(ref.getFromAddress())); callGraph.add(call);
        }
      }
      if (decompile && !function.isExternal() && decompiled < maxDecompile) {
        DecompileResults result = decompiler.decompileFunction(function, 20, monitor);
        if (result.decompileCompleted() && result.getDecompiledFunction() != null) {
          String code = result.getDecompiledFunction().getC();
          Map<String,Object> record = new LinkedHashMap<>(); record.put("function", function.getName()); record.put("entry", text(function.getEntryPoint())); record.put("code", code.length() > 200000 ? code.substring(0, 200000) : code); decompilation.add(record); decompiled++;
        }
      }
    }
    decompiler.dispose();
    root.put("functions", functions); root.put("references", references); root.put("call_graph", callGraph); root.put("decompilation", decompilation);
    root.put("raw_content_persisted", false);
    Gson gson = new GsonBuilder().disableHtmlEscaping().create();
    try (FileWriter writer = new FileWriter(output)) { gson.toJson(root, writer); }
  }
}
