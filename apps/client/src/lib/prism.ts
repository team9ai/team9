/**
 * Centralized Prism.js setup.
 *
 * All language imports MUST go through this file. Importing prismjs components
 * directly from individual files can cause Vite's dep pre-bundling to split
 * them into separate chunks, breaking the execution order that Prism requires
 * (language components depend on `clike` from core being initialized first).
 */
import Prism from "prismjs";

// Core language (must be first — many languages extend clike)
import "prismjs/components/prism-clike";

// Base languages (other languages depend on these)
import "prismjs/components/prism-markup";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-css";
import "prismjs/components/prism-c";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";

// Derived languages (depend on base languages above)
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-php";
import "prismjs/components/prism-markdown";

// Languages extending clike
import "prismjs/components/prism-python";
import "prismjs/components/prism-java";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-csharp";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-dart";

// Independent languages
import "prismjs/components/prism-bash";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-docker";
import "prismjs/components/prism-diff";

export default Prism;
