#!/usr/bin/env python3
"""Governed Frida runner. It accepts template identifiers, never caller source code."""
import argparse
import base64
import json
import sys
import time

import frida

ALLOWED_TEMPLATES = {"observe_module_loads_v1", "observe_function_calls_v1", "observe_file_access_v1"}

def decode_parameters(value):
    padding = "=" * (-len(value) % 4)
    result = json.loads(base64.urlsafe_b64decode(value + padding))
    if not isinstance(result, dict):
        raise ValueError("frida_parameters_invalid")
    return result

def resolve_target(target):
    if target.startswith("pid:"):
        return int(target[4:])
    if target.startswith("process:"):
        name = target[8:]
        matches = [item for item in frida.get_local_device().enumerate_processes() if item.name == name]
        if len(matches) != 1:
            raise RuntimeError("frida_target_not_unique_or_running")
        return matches[0].pid
    raise ValueError("frida_target_format_invalid")

def fixed_script(template, parameters):
    if template == "observe_function_calls_v1":
        module = str(parameters.get("module", ""))
        symbol = str(parameters.get("symbol", ""))
        if not module or not symbol or len(module) > 240 or len(symbol) > 500:
            raise ValueError("frida_function_template_parameters_invalid")
        return """
const moduleName = %s, symbolName = %s;
const targetModule = Process.getModuleByName(moduleName);
const match = targetModule.enumerateSymbols().find(item => item.name === symbolName);
if (!match) throw new Error('allowlisted_symbol_not_found');
const address = match.address;
Interceptor.attach(address, {
  onEnter() { send({kind: 'call_enter', module: moduleName, symbol: symbolName, thread_id: Process.getCurrentThreadId(), monotonic_ms: Date.now()}); },
  onLeave() { send({kind: 'call_leave', module: moduleName, symbol: symbolName, thread_id: Process.getCurrentThreadId(), monotonic_ms: Date.now()}); }
});
""" % (json.dumps(module), json.dumps(symbol))
    if template == "observe_module_loads_v1":
        module_filter = str(parameters.get("module_name_filter", ""))[:240]
        return """
const filter = %s;
Process.attachModuleObserver({onAdded(module) { if (!filter || module.name.includes(filter)) send({kind: 'module_added', name: module.name, base: module.base.toString(), size: module.size}); }});
""" % json.dumps(module_filter)
    if template == "observe_file_access_v1":
        prefix = str(parameters.get("path_prefix", ""))
        if not prefix.startswith("/") or len(prefix) > 500:
            raise ValueError("frida_file_template_parameters_invalid")
        return """
const prefix = %s;
for (const name of ['open', 'openat']) { const address = Module.findGlobalExportByName(name); if (address) Interceptor.attach(address, {onEnter(args) { try { const index = name === 'openat' ? 1 : 0; const path = args[index].readUtf8String(); if (path && path.startsWith(prefix)) send({kind: 'file_access', operation: name, path: path.slice(0, 500), thread_id: Process.getCurrentThreadId()}); } catch (_) {} }}); }
""" % json.dumps(prefix)
    raise ValueError("frida_template_not_allowlisted")

def analyze(args):
    if args.template not in ALLOWED_TEMPLATES:
        raise ValueError("frida_template_not_allowlisted")
    parameters = decode_parameters(args.parameters)
    pid = resolve_target(args.target)
    session = frida.get_local_device().attach(pid)
    events = []
    script = session.create_script(fixed_script(args.template, parameters))
    def on_message(message, _data):
        if len(events) >= args.max_events:
            return
        if message.get("type") == "send" and isinstance(message.get("payload"), dict):
            events.append({"sequence": len(events) + 1, **message["payload"]})
        elif message.get("type") == "error":
            events.append({"sequence": len(events) + 1, "kind": "template_error", "description": str(message.get("description", "error"))[:500]})
    script.on("message", on_message)
    script.load()
    try:
        deadline = time.monotonic() + args.seconds
        while time.monotonic() < deadline and len(events) < args.max_events:
            time.sleep(0.05)
    finally:
        session.detach()
    return {"schema_version": "universal_software_evidence_v1", "analyzer": "frida_local_agent", "network_access": "denied", "target": args.target, "template_id": args.template, "events": events, "event_count": len(events), "raw_content_persisted": False}

def main():
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    probe = sub.add_parser("probe"); probe.add_argument("--json", action="store_true")
    run = sub.add_parser("analyze"); run.add_argument("--target", required=True); run.add_argument("--template", required=True); run.add_argument("--parameters", required=True); run.add_argument("--seconds", type=int, choices=range(1, 61), required=True); run.add_argument("--max-events", type=int, choices=range(1, 2001), required=True)
    args = parser.parse_args()
    if args.command == "probe":
        print(json.dumps({"worker": "frida_local_agent", "version": frida.__version__, "network_access": "denied", "arbitrary_scripts_accepted": False, "templates": sorted(ALLOWED_TEMPLATES)}))
    else:
        print(json.dumps(analyze(args), separators=(",", ":")))

if __name__ == "__main__":
    try: main()
    except Exception as error:
        print(str(error), file=sys.stderr); sys.exit(1)
