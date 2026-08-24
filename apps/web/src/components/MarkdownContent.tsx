import { ChevronDown, Code2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkBreaks from "remark-breaks";
import remarkGfm from "remark-gfm";
import { Children, isValidElement, type ReactNode } from "react";

interface MarkdownContentProps {
  children: string;
  className?: string;
}

function codeLanguage(children: ReactNode): string {
  const code = Children.toArray(children)[0];
  if (!isValidElement(code)) return "代码";
  const props = code.props as { className?: unknown };
  const className = typeof props.className === "string" ? props.className : "";
  const language = className.match(/language-([\w-]+)/)?.[1];
  return language ? `${language} 代码` : "代码";
}

function CollapsibleCode({ children }: { children: ReactNode }) {
  return (
    <details className="code-disclosure">
      <summary>
        <Code2 size={15} aria-hidden="true" />
        <span>{codeLanguage(children)}</span>
        <ChevronDown size={15} className="summary-chevron" aria-hidden="true" />
      </summary>
      <pre>{children}</pre>
    </details>
  );
}

export function MarkdownContent({
  children,
  className = "",
}: MarkdownContentProps) {
  return (
    <div className={`markdown-content ${className}`.trim()}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          pre: ({ children }) => <CollapsibleCode>{children}</CollapsibleCode>,
          a: ({ children: label, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer noopener">
              {label}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
