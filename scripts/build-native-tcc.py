"""Optional Windows build driver using TinyCC's documented shared-library API.

This is a build tool only. Python and TinyCC are not agent runtime dependencies.
Supply an existing, trusted TinyCC library and matching Node-API headers.
"""
import argparse
import ctypes
import json
import os
from pathlib import Path
import re
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--library', required=True)
parser.add_argument('--node-include', required=True)
parser.add_argument('--output', default='native/build/om_kernel.node')
args = parser.parse_args()
root = Path(__file__).resolve().parent.parent
library = Path(args.library).resolve()
include = Path(args.node_include).resolve()
output = Path(args.output).resolve()
if os.name != 'nt' or not (include / 'node_api.h').is_file():
    parser.error('This driver requires Windows and valid Node-API headers.')
output.parent.mkdir(parents=True, exist_ok=True)
compiler = ctypes.CDLL(str(library))
compiler.tcc_new.argtypes = []
compiler.tcc_new.restype = ctypes.c_void_p
for name in ['tcc_set_output_type', 'tcc_add_file', 'tcc_add_include_path', 'tcc_add_library_path', 'tcc_add_library', 'tcc_output_file']:
    method = getattr(compiler, name)
    method.argtypes = [ctypes.c_void_p, ctypes.c_int if name == 'tcc_set_output_type' else ctypes.c_char_p]
    method.restype = ctypes.c_int
compiler.tcc_set_lib_path.argtypes = [ctypes.c_void_p, ctypes.c_char_p]
compiler.tcc_set_lib_path.restype = None
compiler.tcc_delete.argtypes = [ctypes.c_void_p]
compiler.tcc_delete.restype = None
state = compiler.tcc_new()
if not state:
    raise RuntimeError('Cannot allocate TinyCC compiler state.')
def checked(method, value):
    if method(state, value) < 0:
        raise RuntimeError('TinyCC compilation failed; inspect compiler diagnostics.')
try:
    compiler.tcc_set_lib_path(state, os.fsencode(library.parent))
    checked(compiler.tcc_set_output_type, 3)  # TCC_OUTPUT_DLL
    checked(compiler.tcc_add_include_path, os.fsencode(include))
    binding = root / 'native/node_binding.c'
    symbols = sorted(set(re.findall(r'\bnapi_[a-z0-9_]+(?=\()', binding.read_text(encoding='utf-8'))))
    definition = output.parent / 'node.def'
    definition.write_text('LIBRARY node.exe\nEXPORTS\n' + '\n'.join(symbols) + '\n', encoding='ascii')
    for source in [binding, root / 'native/om_kernel.c']:
        checked(compiler.tcc_add_file, os.fsencode(source))
    checked(compiler.tcc_add_library_path, os.fsencode(output.parent))
    checked(compiler.tcc_add_library, b'node')
    checked(compiler.tcc_output_file, os.fsencode(output))
    print(json.dumps({'status': 'built', 'language': 'C', 'abi': 1, 'compiler': str(library), 'output': str(output)}))
finally:
    compiler.tcc_delete(state)
