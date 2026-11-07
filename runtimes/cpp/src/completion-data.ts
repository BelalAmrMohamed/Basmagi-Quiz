// =============================================================================
// runtimes/cpp/src/completion-data.ts
// Static data for C++17 autocomplete: preprocessor directives, standard headers, keywords,
// built-in types, std:: members (with the header each one needs), C library names, common
// member functions and code snippets. Only things that compile under -std=c++17 are listed
// (no <span>, <format>, <ranges>, concepts ...), because that is what the runner uses.
// =============================================================================

export type Kind = 'class' | 'function' | 'variable' | 'constant' | 'namespace' | 'type' | 'keyword';
/** [name, kind, header, signature-or-description] */
export type StdEntry = [string, Kind, string, string];

/** [name, detail, snippet template (after the '#'), info] */
export const DIRECTIVES: Array<[string, string, string, string]> = [
  ['include', 'include a header', 'include <${iostream}>', 'Copies a header into the program: #include <iostream> for standard headers, #include "file.h" for your own.'],
  ['define', 'define a macro', 'define ${NAME} ${value}', 'Defines an object-like macro, or a function-like one: #define SQ(x) ((x) * (x)).'],
  ['undef', 'remove a macro', 'undef ${NAME}', 'Removes a macro definition.'],
  ['if', 'conditional block', 'if ${condition}\n${}\n#endif', 'Compiles the block only when the constant expression is non-zero.'],
  ['ifdef', 'if macro defined', 'ifdef ${NAME}\n${}\n#endif', 'Compiles the block only when the macro is defined.'],
  ['ifndef', 'if macro not defined', 'ifndef ${NAME}\n${}\n#endif', 'Compiles the block only when the macro is not defined.'],
  ['elif', 'else-if branch', 'elif ${condition}', 'Else-if branch of #if.'],
  ['else', 'else branch', 'else', 'Else branch of #if / #ifdef / #ifndef.'],
  ['endif', 'end conditional', 'endif', 'Ends #if / #ifdef / #ifndef.'],
  ['pragma', 'compiler hint', 'pragma ${once}', 'Implementation-defined hint, e.g. #pragma GCC optimize("O2"). Note: #pragma once only makes sense in header files.'],
  ['error', 'stop with an error', 'error "${message}"', 'Stops compilation with the given message.'],
  ['warning', 'emit a warning (GCC)', 'warning "${message}"', 'GCC extension: prints a warning and continues.'],
  ['line', 'set line number', 'line ${number}', 'Sets the line number (and optionally file name) reported in diagnostics.'],
];

/** Headers that exist in C++17 mode. [name, description] */
export const HEADERS: Array<[string, string]> = [
  ['algorithm', 'sort, find, min, max, reverse ...'], ['any', 'std::any'], ['array', 'std::array'], ['atomic', 'std::atomic'],
  ['bitset', 'std::bitset'], ['cassert', 'assert'], ['cctype', 'isdigit, toupper ...'], ['cerrno', 'errno'], ['cfloat', 'DBL_MAX, FLT_EPSILON ...'],
  ['charconv', 'to_chars, from_chars'], ['chrono', 'clocks and durations'], ['climits', 'INT_MAX, LLONG_MAX ...'], ['cmath', 'sqrt, pow, sin ...'],
  ['complex', 'std::complex'], ['condition_variable', 'std::condition_variable'], ['cstddef', 'size_t, nullptr_t, std::byte'],
  ['cstdint', 'int64_t, uint32_t ...'], ['cstdio', 'printf, scanf, fopen ...'], ['cstdlib', 'malloc, rand, exit ...'], ['cstring', 'strlen, memcpy ...'],
  ['ctime', 'time, clock'], ['deque', 'std::deque'], ['exception', 'std::exception'], ['filesystem', 'std::filesystem'],
  ['forward_list', 'std::forward_list'], ['fstream', 'ifstream, ofstream'], ['functional', 'function, bind, greater ...'], ['future', 'async, future, promise'],
  ['initializer_list', 'std::initializer_list'], ['iomanip', 'setw, setprecision ...'], ['ios', 'ios_base, fixed ...'], ['iosfwd', 'stream forward declarations'],
  ['iostream', 'cin, cout, cerr'], ['istream', 'std::istream'], ['iterator', 'back_inserter, next ...'], ['limits', 'numeric_limits'], ['list', 'std::list'],
  ['locale', 'std::locale'], ['map', 'map, multimap'], ['memory', 'unique_ptr, shared_ptr'], ['memory_resource', 'polymorphic allocators'], ['mutex', 'mutex, lock_guard'],
  ['new', 'operator new'], ['numeric', 'accumulate, iota, gcd ...'], ['optional', 'std::optional'], ['ostream', 'std::ostream'], ['queue', 'queue, priority_queue'],
  ['random', 'mt19937, distributions'], ['ratio', 'std::ratio'], ['regex', 'std::regex'], ['set', 'set, multiset'], ['shared_mutex', 'shared_mutex'], ['sstream', 'stringstream'],
  ['stack', 'std::stack'], ['stdexcept', 'runtime_error, out_of_range ...'], ['streambuf', 'std::streambuf'], ['string', 'std::string'], ['string_view', 'std::string_view'],
  ['system_error', 'error_code'], ['thread', 'std::thread'], ['tuple', 'tuple, tie'], ['type_traits', 'is_same, enable_if ...'], ['typeindex', 'type_index'], ['typeinfo', 'typeid'],
  ['unordered_map', 'unordered_map'], ['unordered_set', 'unordered_set'], ['utility', 'pair, move, swap'], ['valarray', 'std::valarray'], ['variant', 'std::variant'], ['vector', 'std::vector'],
  ['bits/stdc++.h', 'GCC: every standard header'],
  ['assert.h', 'C: assert'], ['ctype.h', 'C: character tests'], ['limits.h', 'C: INT_MAX ...'], ['math.h', 'C: math functions'], ['stdint.h', 'C: fixed-width ints'],
  ['stdio.h', 'C: printf, scanf'], ['stdlib.h', 'C: malloc, rand'], ['string.h', 'C: strlen, memcpy'], ['time.h', 'C: time, clock'],
];

export const KEYWORDS: string[] = [
  'alignas', 'alignof', 'and', 'and_eq', 'asm', 'bitand', 'bitor', 'break', 'case', 'compl', 'const', 'const_cast', 'constexpr', 'continue',
  'decltype', 'default', 'delete', 'dynamic_cast', 'else', 'explicit', 'export', 'extern', 'false', 'final', 'friend', 'goto', 'inline',
  'mutable', 'new', 'noexcept', 'not', 'not_eq', 'nullptr', 'operator', 'or', 'or_eq', 'override', 'private', 'protected', 'public', 'register',
  'reinterpret_cast', 'return', 'sizeof', 'static', 'static_assert', 'static_cast', 'this', 'thread_local', 'throw', 'true', 'typedef', 'typeid',
  'typename', 'using', 'virtual', 'volatile', 'xor', 'xor_eq', 'catch',
];
// Keywords that have a snippet instead (for, while, if, switch, do, try, class, struct, union, enum, namespace, template) are offered by SNIPPETS.

export const TYPES: string[] = [
  'auto', 'bool', 'char', 'char16_t', 'char32_t', 'double', 'float', 'int', 'long', 'long long', 'long double', 'short', 'signed', 'unsigned',
  'unsigned int', 'unsigned long', 'unsigned long long', 'unsigned char', 'void', 'wchar_t',
  'size_t', 'ptrdiff_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'intmax_t', 'uintmax_t',
];

const S = (name: string, kind: Kind, header: string, sig: string): StdEntry => [name, kind, header, sig];

export const STD_MEMBERS: StdEntry[] = [
  // ---- I/O
  S('cout', 'variable', 'iostream', 'std::ostream — standard output'), S('cin', 'variable', 'iostream', 'std::istream — standard input'),
  S('cerr', 'variable', 'iostream', 'std::ostream — unbuffered error output'), S('clog', 'variable', 'iostream', 'std::ostream — buffered log output'),
  S('endl', 'function', 'ostream', 'ostream& endl(ostream&) — newline and flush'), S('flush', 'function', 'ostream', 'ostream& flush(ostream&)'), S('ws', 'function', 'istream', 'skip whitespace'),
  S('getline', 'function', 'string', 'getline(istream& in, string& line, char delim = \'\\n\')'),
  S('ostream', 'class', 'ostream', 'output stream'), S('istream', 'class', 'istream', 'input stream'), S('iostream', 'class', 'iostream', 'input/output stream'),
  S('ios', 'class', 'ios', 'stream base class'), S('ios_base', 'class', 'ios', 'stream base class (sync_with_stdio, flags)'),
  S('ifstream', 'class', 'fstream', 'file input stream'), S('ofstream', 'class', 'fstream', 'file output stream'), S('fstream', 'class', 'fstream', 'file stream'),
  S('stringstream', 'class', 'sstream', 'string in/out stream'), S('istringstream', 'class', 'sstream', 'string input stream'), S('ostringstream', 'class', 'sstream', 'string output stream'),
  S('setw', 'function', 'iomanip', 'setw(int width)'), S('setprecision', 'function', 'iomanip', 'setprecision(int digits)'), S('setfill', 'function', 'iomanip', 'setfill(char c)'),
  S('setbase', 'function', 'iomanip', 'setbase(int base)'), S('fixed', 'function', 'ios', 'fixed-point notation'), S('scientific', 'function', 'ios', 'scientific notation'),
  S('boolalpha', 'function', 'ios', 'print bool as true/false'), S('noboolalpha', 'function', 'ios', 'print bool as 1/0'), S('hex', 'function', 'ios', 'hexadecimal'),
  S('dec', 'function', 'ios', 'decimal'), S('oct', 'function', 'ios', 'octal'), S('left', 'function', 'ios', 'left-align'), S('right', 'function', 'ios', 'right-align'),
  S('showpoint', 'function', 'ios', 'always show decimal point'), S('showpos', 'function', 'ios', 'show + for positives'), S('uppercase', 'function', 'ios', 'uppercase hex digits'),
  // ---- strings
  S('string', 'class', 'string', 'std::string'), S('wstring', 'class', 'string', 'std::wstring'), S('string_view', 'class', 'string_view', 'non-owning string view'),
  S('to_string', 'function', 'string', 'string to_string(number)'), S('stoi', 'function', 'string', 'int stoi(const string&, size_t* pos = 0, int base = 10)'),
  S('stol', 'function', 'string', 'long stol(const string&)'), S('stoll', 'function', 'string', 'long long stoll(const string&)'), S('stoul', 'function', 'string', 'unsigned long stoul(const string&)'),
  S('stoull', 'function', 'string', 'unsigned long long stoull(const string&)'), S('stof', 'function', 'string', 'float stof(const string&)'), S('stod', 'function', 'string', 'double stod(const string&)'),
  S('stold', 'function', 'string', 'long double stold(const string&)'),
  // ---- containers & vocabulary types
  S('vector', 'class', 'vector', 'dynamic array: vector<T>'), S('array', 'class', 'array', 'fixed-size array: array<T, N>'), S('deque', 'class', 'deque', 'double-ended queue'),
  S('list', 'class', 'list', 'doubly linked list'), S('forward_list', 'class', 'forward_list', 'singly linked list'), S('map', 'class', 'map', 'ordered key/value map'),
  S('multimap', 'class', 'map', 'ordered multi-map'), S('set', 'class', 'set', 'ordered set'), S('multiset', 'class', 'set', 'ordered multi-set'),
  S('unordered_map', 'class', 'unordered_map', 'hash map'), S('unordered_multimap', 'class', 'unordered_map', 'hash multi-map'), S('unordered_set', 'class', 'unordered_set', 'hash set'),
  S('unordered_multiset', 'class', 'unordered_set', 'hash multi-set'), S('stack', 'class', 'stack', 'LIFO adaptor'), S('queue', 'class', 'queue', 'FIFO adaptor'),
  S('priority_queue', 'class', 'queue', 'heap adaptor (max-heap by default)'), S('bitset', 'class', 'bitset', 'bitset<N>'), S('pair', 'class', 'utility', 'pair<A, B>'),
  S('tuple', 'class', 'tuple', 'tuple<Ts...>'), S('optional', 'class', 'optional', 'optional<T>'), S('variant', 'class', 'variant', 'variant<Ts...>'), S('any', 'class', 'any', 'type-erased value'),
  S('make_pair', 'function', 'utility', 'make_pair(a, b)'), S('make_tuple', 'function', 'tuple', 'make_tuple(args...)'), S('tie', 'function', 'tuple', 'tie(refs...)'),
  S('get', 'function', 'tuple', 'get<I>(tuple_or_pair)'), S('make_optional', 'function', 'optional', 'make_optional(value)'), S('nullopt', 'constant', 'optional', 'empty optional'),
  S('initializer_list', 'class', 'initializer_list', 'initializer_list<T>'),
  // ---- algorithms
  S('sort', 'function', 'algorithm', 'sort(first, last [, comp])'), S('stable_sort', 'function', 'algorithm', 'stable_sort(first, last [, comp])'), S('partial_sort', 'function', 'algorithm', 'partial_sort(first, middle, last)'),
  S('nth_element', 'function', 'algorithm', 'nth_element(first, nth, last)'), S('reverse', 'function', 'algorithm', 'reverse(first, last)'), S('rotate', 'function', 'algorithm', 'rotate(first, middle, last)'),
  S('shuffle', 'function', 'algorithm', 'shuffle(first, last, urbg)'), S('unique', 'function', 'algorithm', 'unique(first, last)'), S('find', 'function', 'algorithm', 'find(first, last, value)'),
  S('find_if', 'function', 'algorithm', 'find_if(first, last, pred)'), S('find_if_not', 'function', 'algorithm', 'find_if_not(first, last, pred)'), S('count', 'function', 'algorithm', 'count(first, last, value)'),
  S('count_if', 'function', 'algorithm', 'count_if(first, last, pred)'), S('min', 'function', 'algorithm', 'min(a, b)'), S('max', 'function', 'algorithm', 'max(a, b)'), S('minmax', 'function', 'algorithm', 'minmax(a, b)'),
  S('min_element', 'function', 'algorithm', 'min_element(first, last)'), S('max_element', 'function', 'algorithm', 'max_element(first, last)'), S('minmax_element', 'function', 'algorithm', 'minmax_element(first, last)'),
  S('clamp', 'function', 'algorithm', 'clamp(v, lo, hi) — C++17'), S('swap', 'function', 'utility', 'swap(a, b)'), S('iter_swap', 'function', 'algorithm', 'iter_swap(it1, it2)'),
  S('transform', 'function', 'algorithm', 'transform(first, last, out, op)'), S('for_each', 'function', 'algorithm', 'for_each(first, last, fn)'), S('copy', 'function', 'algorithm', 'copy(first, last, out)'),
  S('copy_if', 'function', 'algorithm', 'copy_if(first, last, out, pred)'), S('copy_n', 'function', 'algorithm', 'copy_n(first, n, out)'), S('fill', 'function', 'algorithm', 'fill(first, last, value)'),
  S('fill_n', 'function', 'algorithm', 'fill_n(first, n, value)'), S('generate', 'function', 'algorithm', 'generate(first, last, gen)'), S('remove', 'function', 'algorithm', 'remove(first, last, value)'),
  S('remove_if', 'function', 'algorithm', 'remove_if(first, last, pred)'), S('replace', 'function', 'algorithm', 'replace(first, last, old, new)'), S('replace_if', 'function', 'algorithm', 'replace_if(first, last, pred, new)'),
  S('lower_bound', 'function', 'algorithm', 'lower_bound(first, last, value)'), S('upper_bound', 'function', 'algorithm', 'upper_bound(first, last, value)'), S('binary_search', 'function', 'algorithm', 'binary_search(first, last, value)'),
  S('equal_range', 'function', 'algorithm', 'equal_range(first, last, value)'), S('all_of', 'function', 'algorithm', 'all_of(first, last, pred)'), S('any_of', 'function', 'algorithm', 'any_of(first, last, pred)'),
  S('none_of', 'function', 'algorithm', 'none_of(first, last, pred)'), S('next_permutation', 'function', 'algorithm', 'next_permutation(first, last)'), S('prev_permutation', 'function', 'algorithm', 'prev_permutation(first, last)'),
  S('is_sorted', 'function', 'algorithm', 'is_sorted(first, last)'), S('merge', 'function', 'algorithm', 'merge(f1, l1, f2, l2, out)'), S('inplace_merge', 'function', 'algorithm', 'inplace_merge(first, middle, last)'),
  S('includes', 'function', 'algorithm', 'includes(f1, l1, f2, l2)'), S('set_union', 'function', 'algorithm', 'set_union(f1, l1, f2, l2, out)'), S('set_intersection', 'function', 'algorithm', 'set_intersection(f1, l1, f2, l2, out)'),
  S('set_difference', 'function', 'algorithm', 'set_difference(f1, l1, f2, l2, out)'), S('equal', 'function', 'algorithm', 'equal(f1, l1, f2)'), S('mismatch', 'function', 'algorithm', 'mismatch(f1, l1, f2)'),
  S('lexicographical_compare', 'function', 'algorithm', 'lexicographical_compare(f1, l1, f2, l2)'), S('search', 'function', 'algorithm', 'search(f1, l1, f2, l2)'), S('is_permutation', 'function', 'algorithm', 'is_permutation(f1, l1, f2)'),
  // ---- numeric
  S('accumulate', 'function', 'numeric', 'accumulate(first, last, init [, op])'), S('iota', 'function', 'numeric', 'iota(first, last, start)'), S('partial_sum', 'function', 'numeric', 'partial_sum(first, last, out)'),
  S('adjacent_difference', 'function', 'numeric', 'adjacent_difference(first, last, out)'), S('inner_product', 'function', 'numeric', 'inner_product(f1, l1, f2, init)'),
  S('gcd', 'function', 'numeric', 'gcd(a, b) — C++17'), S('lcm', 'function', 'numeric', 'lcm(a, b) — C++17'), S('reduce', 'function', 'numeric', 'reduce(first, last [, init, op]) — C++17'),
  S('numeric_limits', 'class', 'limits', 'numeric_limits<T>::max(), min(), epsilon()'),
  // ---- iterators
  S('begin', 'function', 'iterator', 'begin(container)'), S('end', 'function', 'iterator', 'end(container)'), S('rbegin', 'function', 'iterator', 'rbegin(container)'), S('rend', 'function', 'iterator', 'rend(container)'),
  S('cbegin', 'function', 'iterator', 'cbegin(container)'), S('cend', 'function', 'iterator', 'cend(container)'), S('size', 'function', 'iterator', 'size(container)'), S('empty', 'function', 'iterator', 'empty(container)'),
  S('data', 'function', 'iterator', 'data(container)'), S('distance', 'function', 'iterator', 'distance(first, last)'), S('advance', 'function', 'iterator', 'advance(it, n)'),
  S('next', 'function', 'iterator', 'next(it, n = 1)'), S('prev', 'function', 'iterator', 'prev(it, n = 1)'), S('back_inserter', 'function', 'iterator', 'back_inserter(container)'),
  S('front_inserter', 'function', 'iterator', 'front_inserter(container)'), S('inserter', 'function', 'iterator', 'inserter(container, pos)'),
  // ---- utility, functional, memory
  S('move', 'function', 'utility', 'move(x) — cast to rvalue'), S('forward', 'function', 'utility', 'forward<T>(x)'), S('exchange', 'function', 'utility', 'exchange(obj, new_value)'),
  S('function', 'class', 'functional', 'function<R(Args...)>'), S('bind', 'function', 'functional', 'bind(fn, args...)'), S('ref', 'function', 'functional', 'ref(x)'), S('cref', 'function', 'functional', 'cref(x)'),
  S('plus', 'class', 'functional', 'plus<T>'), S('minus', 'class', 'functional', 'minus<T>'), S('multiplies', 'class', 'functional', 'multiplies<T>'), S('divides', 'class', 'functional', 'divides<T>'),
  S('less', 'class', 'functional', 'less<T>'), S('greater', 'class', 'functional', 'greater<T>'), S('equal_to', 'class', 'functional', 'equal_to<T>'), S('hash', 'class', 'functional', 'hash<T>'),
  S('unique_ptr', 'class', 'memory', 'unique_ptr<T>'), S('shared_ptr', 'class', 'memory', 'shared_ptr<T>'), S('weak_ptr', 'class', 'memory', 'weak_ptr<T>'),
  S('make_unique', 'function', 'memory', 'make_unique<T>(args...)'), S('make_shared', 'function', 'memory', 'make_shared<T>(args...)'),
  S('is_same', 'class', 'type_traits', 'is_same<A, B>::value'), S('is_integral', 'class', 'type_traits', 'is_integral<T>::value'), S('is_floating_point', 'class', 'type_traits', 'is_floating_point<T>::value'),
  S('enable_if', 'class', 'type_traits', 'enable_if<cond, T>::type'), S('conditional', 'class', 'type_traits', 'conditional<cond, A, B>::type'), S('decay', 'class', 'type_traits', 'decay<T>::type'),
  S('remove_reference', 'class', 'type_traits', 'remove_reference<T>::type'), S('declval', 'function', 'utility', 'declval<T>()'),
  // ---- math
  S('sqrt', 'function', 'cmath', 'sqrt(x)'), S('pow', 'function', 'cmath', 'pow(base, exp)'), S('abs', 'function', 'cstdlib', 'abs(x)'), S('fabs', 'function', 'cmath', 'fabs(x)'),
  S('floor', 'function', 'cmath', 'floor(x)'), S('ceil', 'function', 'cmath', 'ceil(x)'), S('round', 'function', 'cmath', 'round(x)'), S('trunc', 'function', 'cmath', 'trunc(x)'),
  S('fmod', 'function', 'cmath', 'fmod(x, y)'), S('exp', 'function', 'cmath', 'exp(x)'), S('log', 'function', 'cmath', 'log(x) — natural log'), S('log2', 'function', 'cmath', 'log2(x)'),
  S('log10', 'function', 'cmath', 'log10(x)'), S('sin', 'function', 'cmath', 'sin(x)'), S('cos', 'function', 'cmath', 'cos(x)'), S('tan', 'function', 'cmath', 'tan(x)'),
  S('asin', 'function', 'cmath', 'asin(x)'), S('acos', 'function', 'cmath', 'acos(x)'), S('atan', 'function', 'cmath', 'atan(x)'), S('atan2', 'function', 'cmath', 'atan2(y, x)'),
  S('sinh', 'function', 'cmath', 'sinh(x)'), S('cosh', 'function', 'cmath', 'cosh(x)'), S('tanh', 'function', 'cmath', 'tanh(x)'), S('hypot', 'function', 'cmath', 'hypot(x, y)'),
  S('cbrt', 'function', 'cmath', 'cbrt(x)'), S('isnan', 'function', 'cmath', 'isnan(x)'), S('isinf', 'function', 'cmath', 'isinf(x)'), S('isfinite', 'function', 'cmath', 'isfinite(x)'),
  S('lround', 'function', 'cmath', 'long lround(x)'), S('llround', 'function', 'cmath', 'long long llround(x)'),
  // ---- random
  S('mt19937', 'class', 'random', '32-bit Mersenne Twister'), S('mt19937_64', 'class', 'random', '64-bit Mersenne Twister'), S('random_device', 'class', 'random', 'non-deterministic seed source'),
  S('default_random_engine', 'class', 'random', 'default engine'), S('uniform_int_distribution', 'class', 'random', 'uniform_int_distribution<int>(lo, hi)'),
  S('uniform_real_distribution', 'class', 'random', 'uniform_real_distribution<double>(lo, hi)'), S('normal_distribution', 'class', 'random', 'normal_distribution<double>(mean, sd)'),
  S('bernoulli_distribution', 'class', 'random', 'bernoulli_distribution(p)'),
  // ---- exceptions
  S('exception', 'class', 'exception', 'base class of standard exceptions'), S('runtime_error', 'class', 'stdexcept', 'runtime_error(const string&)'), S('logic_error', 'class', 'stdexcept', 'logic_error(const string&)'),
  S('invalid_argument', 'class', 'stdexcept', 'invalid_argument(const string&)'), S('out_of_range', 'class', 'stdexcept', 'out_of_range(const string&)'), S('domain_error', 'class', 'stdexcept', 'domain_error(const string&)'),
  S('length_error', 'class', 'stdexcept', 'length_error(const string&)'), S('overflow_error', 'class', 'stdexcept', 'overflow_error(const string&)'), S('underflow_error', 'class', 'stdexcept', 'underflow_error(const string&)'),
  S('range_error', 'class', 'stdexcept', 'range_error(const string&)'), S('bad_alloc', 'class', 'new', 'allocation failure'), S('terminate', 'function', 'exception', 'terminate()'),
  // ---- concurrency and time
  S('thread', 'class', 'thread', 'thread(fn, args...)'), S('mutex', 'class', 'mutex', 'mutual exclusion'), S('lock_guard', 'class', 'mutex', 'lock_guard<mutex>'), S('unique_lock', 'class', 'mutex', 'unique_lock<mutex>'),
  S('condition_variable', 'class', 'condition_variable', 'wait / notify'), S('atomic', 'class', 'atomic', 'atomic<T>'), S('async', 'function', 'future', 'async(policy, fn, args...)'), S('future', 'class', 'future', 'future<T>'),
  S('promise', 'class', 'future', 'promise<T>'), S('this_thread', 'namespace', 'thread', 'sleep_for, yield, get_id'), S('chrono', 'namespace', 'chrono', 'clocks, durations, time points'),
  S('byte', 'type', 'cstddef', 'std::byte — C++17'), S('nullptr_t', 'type', 'cstddef', 'type of nullptr'),
];

/** Members of std::chrono and std::this_thread, offered after `std::chrono::` / `std::this_thread::`. */
export const NESTED: Record<string, Array<[string, Kind, string]>> = {
  chrono: [
    ['steady_clock', 'class', 'monotonic clock; steady_clock::now()'], ['system_clock', 'class', 'wall clock; system_clock::now()'], ['high_resolution_clock', 'class', 'highest-resolution clock'],
    ['duration', 'class', 'duration<Rep, Period>'], ['duration_cast', 'function', 'duration_cast<ToDuration>(d)'], ['time_point', 'class', 'time_point<Clock>'],
    ['hours', 'type', 'duration in hours'], ['minutes', 'type', 'duration in minutes'], ['seconds', 'type', 'duration in seconds'], ['milliseconds', 'type', 'duration in milliseconds'],
    ['microseconds', 'type', 'duration in microseconds'], ['nanoseconds', 'type', 'duration in nanoseconds'],
  ],
  this_thread: [['sleep_for', 'function', 'sleep_for(duration)'], ['sleep_until', 'function', 'sleep_until(time_point)'], ['yield', 'function', 'yield()'], ['get_id', 'function', 'get_id()']],
};

/** C library functions, constants and predefined macros that are usable without a std:: prefix. [name, kind, signature] */
export const GLOBALS: Array<[string, Kind, string]> = [
  ['printf', 'function', 'int printf(const char* fmt, ...)'], ['scanf', 'function', 'int scanf(const char* fmt, ...)'], ['puts', 'function', 'int puts(const char*)'],
  ['putchar', 'function', 'int putchar(int)'], ['getchar', 'function', 'int getchar()'], ['sprintf', 'function', 'int sprintf(char*, const char*, ...)'], ['snprintf', 'function', 'int snprintf(char*, size_t, const char*, ...)'],
  ['fprintf', 'function', 'int fprintf(FILE*, const char*, ...)'], ['fopen', 'function', 'FILE* fopen(const char* path, const char* mode)'], ['fclose', 'function', 'int fclose(FILE*)'], ['fgets', 'function', 'char* fgets(char*, int, FILE*)'],
  ['malloc', 'function', 'void* malloc(size_t)'], ['calloc', 'function', 'void* calloc(size_t, size_t)'], ['realloc', 'function', 'void* realloc(void*, size_t)'], ['free', 'function', 'void free(void*)'],
  ['exit', 'function', 'void exit(int)'], ['abort', 'function', 'void abort()'], ['atoi', 'function', 'int atoi(const char*)'], ['atof', 'function', 'double atof(const char*)'], ['strtol', 'function', 'long strtol(const char*, char**, int)'],
  ['rand', 'function', 'int rand()'], ['srand', 'function', 'void srand(unsigned)'], ['qsort', 'function', 'void qsort(void*, size_t, size_t, cmp)'], ['bsearch', 'function', 'void* bsearch(key, base, n, size, cmp)'],
  ['strlen', 'function', 'size_t strlen(const char*)'], ['strcpy', 'function', 'char* strcpy(char*, const char*)'], ['strncpy', 'function', 'char* strncpy(char*, const char*, size_t)'], ['strcmp', 'function', 'int strcmp(const char*, const char*)'],
  ['strncmp', 'function', 'int strncmp(const char*, const char*, size_t)'], ['strcat', 'function', 'char* strcat(char*, const char*)'], ['strchr', 'function', 'char* strchr(const char*, int)'], ['strstr', 'function', 'char* strstr(const char*, const char*)'],
  ['memcpy', 'function', 'void* memcpy(void*, const void*, size_t)'], ['memset', 'function', 'void* memset(void*, int, size_t)'], ['memmove', 'function', 'void* memmove(void*, const void*, size_t)'], ['memcmp', 'function', 'int memcmp(const void*, const void*, size_t)'],
  ['toupper', 'function', 'int toupper(int)'], ['tolower', 'function', 'int tolower(int)'], ['isdigit', 'function', 'int isdigit(int)'], ['isalpha', 'function', 'int isalpha(int)'], ['isalnum', 'function', 'int isalnum(int)'],
  ['isspace', 'function', 'int isspace(int)'], ['isupper', 'function', 'int isupper(int)'], ['islower', 'function', 'int islower(int)'], ['ispunct', 'function', 'int ispunct(int)'],
  ['time', 'function', 'time_t time(time_t*)'], ['clock', 'function', 'clock_t clock()'], ['assert', 'function', 'assert(condition)'],
  ['CLOCKS_PER_SEC', 'constant', 'clock ticks per second'], ['NULL', 'constant', 'null pointer constant'], ['EOF', 'constant', 'end-of-file marker'], ['RAND_MAX', 'constant', 'maximum of rand()'],
  ['EXIT_SUCCESS', 'constant', '0'], ['EXIT_FAILURE', 'constant', '1'], ['INT_MAX', 'constant', '<climits>'], ['INT_MIN', 'constant', '<climits>'], ['UINT_MAX', 'constant', '<climits>'],
  ['LONG_MAX', 'constant', '<climits>'], ['LLONG_MAX', 'constant', '<climits>'], ['LLONG_MIN', 'constant', '<climits>'], ['DBL_MAX', 'constant', '<cfloat>'], ['DBL_EPSILON', 'constant', '<cfloat>'], ['FLT_MAX', 'constant', '<cfloat>'],
  ['M_PI', 'constant', 'π (GCC, <cmath>)'], ['M_E', 'constant', 'e (GCC, <cmath>)'], ['__cplusplus', 'constant', 'language standard, e.g. 201703L'], ['__FILE__', 'constant', 'current file name'], ['__LINE__', 'constant', 'current line number'],
  ['__func__', 'constant', 'current function name'], ['__DATE__', 'constant', 'compilation date'], ['__TIME__', 'constant', 'compilation time'], ['__GNUC__', 'constant', 'GCC major version'],
];

/** Common member functions / fields, offered after `.` and `->`. [name, signature-or-description] */
export const MEMBERS: Array<[string, string]> = [
  ['size', 'number of elements'], ['length', 'string length'], ['empty', 'true if no elements'], ['clear', 'remove all elements'], ['push_back', 'append an element'], ['pop_back', 'remove the last element'],
  ['emplace_back', 'construct an element at the end'], ['emplace', 'construct an element in place'], ['emplace_hint', 'construct near a hint'], ['push', 'queue/stack/priority_queue: add'], ['pop', 'queue/stack/priority_queue: remove'],
  ['push_front', 'deque/list: prepend'], ['pop_front', 'deque/list: remove first'], ['top', 'stack/priority_queue: top element'], ['front', 'first element'], ['back', 'last element'],
  ['begin', 'iterator to first'], ['end', 'iterator past last'], ['rbegin', 'reverse begin'], ['rend', 'reverse end'], ['cbegin', 'const begin'], ['cend', 'const end'],
  ['insert', 'insert element(s)'], ['erase', 'remove element(s)'], ['find', 'search (containers, strings)'], ['count', 'occurrences of a key'], ['at', 'bounds-checked access'], ['data', 'pointer to storage'],
  ['resize', 'change size'], ['reserve', 'reserve capacity'], ['capacity', 'allocated capacity'], ['shrink_to_fit', 'release unused capacity'], ['assign', 'replace contents'], ['swap', 'swap contents'],
  ['substr', 'substring(pos, len)'], ['append', 'append to a string'], ['c_str', 'null-terminated C string'], ['compare', 'three-way compare'], ['rfind', 'search backwards'], ['find_first_of', 'find any of characters'],
  ['find_last_of', 'find last of characters'], ['find_first_not_of', 'find first not in set'], ['replace', 'replace a range'], ['lower_bound', 'first element not less than key'], ['upper_bound', 'first element greater than key'],
  ['equal_range', 'range of equal keys'], ['first', 'pair: first element'], ['second', 'pair: second element'], ['get', 'smart pointer: raw pointer'], ['reset', 'smart pointer / optional: reset'],
  ['release', 'unique_ptr: give up ownership'], ['has_value', 'optional: has a value'], ['value', 'optional: the value'], ['value_or', 'optional: value or default'], ['max_size', 'largest possible size'],
  ['open', 'stream: open a file'], ['close', 'stream: close'], ['is_open', 'stream: is open'], ['eof', 'stream: end of file'], ['fail', 'stream: operation failed'], ['good', 'stream: no error'], ['bad', 'stream: fatal error'],
  ['ignore', 'stream: skip characters'], ['peek', 'stream: next char without consuming'], ['getline', 'stream: read a line'], ['put', 'stream: write a char'], ['write', 'stream: write bytes'], ['read', 'stream: read bytes'],
  ['flush', 'stream: flush'], ['str', 'stringstream: the string'], ['tie', 'stream: tied stream'], ['sync_with_stdio', 'ios: toggle C stdio sync'], ['precision', 'stream: set precision'], ['width', 'stream: set width'],
  ['fill', 'stream/array: fill'], ['setf', 'stream: set format flags'], ['test', 'bitset: test a bit'], ['set', 'bitset: set bit(s)'], ['flip', 'bitset: flip bit(s)'], ['any', 'bitset: any bit set'],
  ['none', 'bitset: no bit set'], ['all', 'bitset: all bits set'], ['to_string', 'bitset: as a string'], ['to_ulong', 'bitset: as unsigned long'], ['join', 'thread: wait for completion'], ['joinable', 'thread: can be joined'],
  ['detach', 'thread: detach'], ['lock', 'mutex: lock'], ['unlock', 'mutex: unlock'], ['try_lock', 'mutex: try to lock'], ['notify_one', 'condition_variable: wake one'], ['notify_all', 'condition_variable: wake all'],
  ['wait', 'condition_variable / future: wait'], ['load', 'atomic: read'], ['store', 'atomic: write'], ['fetch_add', 'atomic: add and return old'], ['what', 'exception: message'], ['merge', 'list/map/set: merge'],
  ['splice', 'list: move elements'], ['sort', 'list: sort'], ['reverse', 'list: reverse'], ['unique', 'list: remove duplicates'], ['remove', 'list: remove by value'], ['remove_if', 'list: remove by predicate'],
  ['npos', 'string::npos — "not found"'],
];

/** Snippet templates. `{std}` is replaced with "std::" unless `using namespace std;` is in the notebook. */
export type SnippetSpec = { label: string; detail: string; template: string; info?: string };
export const SNIPPETS: SnippetSpec[] = [
  { label: 'main', detail: 'int main()', template: 'int main() {\n    ${}\n    return 0;\n}', info: 'Program entry point. A notebook cell may define main(); it is run in order with the other cells.' },
  { label: 'main', detail: 'int main(argc, argv)', template: 'int main(int argc, char* argv[]) {\n    ${}\n    return 0;\n}' },
  { label: 'for', detail: 'for loop', template: 'for (int ${i} = 0; ${i} < ${n}; ++${i}) {\n    ${}\n}' },
  { label: 'forr', detail: 'range-based for', template: 'for (${auto&} ${x} : ${container}) {\n    ${}\n}', info: 'Range-based for loop over a container.' },
  { label: 'while', detail: 'while loop', template: 'while (${condition}) {\n    ${}\n}' },
  { label: 'do', detail: 'do … while', template: 'do {\n    ${}\n} while (${condition});' },
  { label: 'if', detail: 'if', template: 'if (${condition}) {\n    ${}\n}' },
  { label: 'ifelse', detail: 'if … else', template: 'if (${condition}) {\n    ${}\n} else {\n    ${}\n}' },
  { label: 'switch', detail: 'switch', template: 'switch (${value}) {\n    case ${1}:\n        ${}\n        break;\n    default:\n        break;\n}' },
  { label: 'try', detail: 'try … catch', template: 'try {\n    ${}\n} catch (const {std}exception& ${e}) {\n    {std}cerr << ${e}.what() << {std}endl;\n}' },
  { label: 'cout <<', detail: 'print a line', template: '{std}cout << ${} << {std}endl;', info: 'Writes to standard output. Needs #include <iostream>.' },
  { label: 'cin >>', detail: 'read a value', template: '{std}cin >> ${variable};', info: 'Reads from standard input. A cell that uses cin asks for its input when it runs.' },
  { label: 'fastio', detail: 'fast I/O prelude', template: '{std}ios::sync_with_stdio(false);\n{std}cin.tie(nullptr);', info: 'Unties cin/cout from C stdio for faster input.' },
  { label: 'class', detail: 'class', template: 'class ${Name} {\npublic:\n    ${Name}(${}) {}\n\nprivate:\n    ${}\n};' },
  { label: 'struct', detail: 'struct', template: 'struct ${Name} {\n    ${int} ${member};\n};' },
  { label: 'enum', detail: 'enum class', template: 'enum class ${Name} {\n    ${A},\n    ${B},\n};' },
  { label: 'union', detail: 'union', template: 'union ${Name} {\n    ${int} ${a};\n    ${float} ${b};\n};' },
  { label: 'namespace', detail: 'namespace', template: 'namespace ${name} {\n    ${}\n}' },
  { label: 'template', detail: 'function template', template: 'template <typename ${T}>\n${T} ${name}(${T} ${a}) {\n    ${}\n}' },
  { label: 'func', detail: 'function', template: '${int} ${name}(${int} ${a}) {\n    ${}\n}' },
  { label: 'lambda', detail: 'lambda expression', template: '[${&}](${int} ${a}) {\n    ${}\n}' },
  { label: 'vector', detail: 'vector declaration', template: '{std}vector<${int}> ${v}(${n});', info: 'Needs #include <vector>.' },
  { label: 'sortv', detail: 'sort a vector', template: '{std}sort(${v}.begin(), ${v}.end());', info: 'Needs #include <algorithm>.' },
];
