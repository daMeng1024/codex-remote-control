import type { ConnectionDto, ThreadSummaryDto } from "@codex-remote/shared";
import { Archive, CirclePlus, LogOut, RefreshCw, Search } from "lucide-react";

interface ThreadSidebarProps {
  connection: ConnectionDto;
  threads: ThreadSummaryDto[];
  selectedId: string | null;
  search: string;
  status: string;
  archived: boolean;
  loading: boolean;
  hasMore: boolean;
  readOnly: boolean;
  mobileHidden: boolean;
  onSearch: (value: string) => void;
  onStatus: (value: string) => void;
  onArchived: (value: boolean) => void;
  onSelect: (id: string) => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onCreate: () => void;
  onLogout: () => void;
}

function relativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.floor(Date.now() / 1000 - timestamp));
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} 小时`;
  return `${Math.floor(seconds / 86400)} 天`;
}

function statusText(thread: ThreadSummaryDto): string {
  if (thread.status.waitingOnApproval) return "待审批";
  if (thread.status.waitingOnUserInput) return "待输入";
  if (thread.status.type === "active") return "运行中";
  if (thread.status.type === "idle") return "空闲";
  if (thread.status.type === "systemError") return "异常";
  return "未加载";
}

export function ThreadSidebar(props: ThreadSidebarProps) {
  return (
    <aside
      className={`thread-sidebar ${props.mobileHidden ? "mobile-hidden" : ""}`}
    >
      <header className="sidebar-header">
        <div className="brand-lockup">
          <span className="brand-glyph">&gt;_</span>
          <div>
            <strong>Codex 工作台</strong>
            <span
              className={`connection-label state-${props.connection.state}`}
            >
              {props.connection.state === "connected"
                ? "已连接"
                : props.connection.message}
            </span>
          </div>
        </div>
      </header>

      <div className="sidebar-actions">
        <button
          className="primary-button create-button"
          onClick={props.onCreate}
          disabled={props.readOnly}
        >
          <CirclePlus size={18} />
          新建会话
        </button>
        <button
          className="icon-button"
          onClick={props.onRefresh}
          title="刷新会话"
          aria-label="刷新会话"
        >
          <RefreshCw className={props.loading ? "spin" : ""} size={18} />
        </button>
      </div>

      <div className="thread-filters">
        <label className="search-field">
          <Search size={17} aria-hidden="true" />
          <input
            aria-label="搜索会话"
            placeholder="搜索会话"
            value={props.search}
            onChange={(event) => props.onSearch(event.target.value)}
          />
        </label>
        <div className="filter-row">
          <select
            aria-label="会话状态"
            value={props.status}
            onChange={(event) => props.onStatus(event.target.value)}
          >
            <option value="">全部状态</option>
            <option value="active">运行中</option>
            <option value="idle">空闲</option>
            <option value="notLoaded">未加载</option>
            <option value="systemError">异常</option>
          </select>
          <label className="archive-toggle">
            <input
              type="checkbox"
              checked={props.archived}
              onChange={(event) => props.onArchived(event.target.checked)}
            />
            <Archive size={15} />
            已归档
          </label>
        </div>
      </div>

      <nav className="thread-list" aria-label="会话列表">
        {props.threads.length === 0 && !props.loading ? (
          <div className="empty-list">暂无会话</div>
        ) : null}
        {props.threads.map((thread) => (
          <button
            key={thread.id}
            className={`thread-row ${props.selectedId === thread.id ? "selected" : ""}`}
            onClick={() => props.onSelect(thread.id)}
          >
            <span
              className={`status-dot status-${thread.status.type}`}
              aria-hidden="true"
            />
            <span className="thread-copy">
              <strong>{thread.name || thread.preview || "未命名会话"}</strong>
              <span className="thread-path">{thread.cwd}</span>
              <span className="thread-meta">
                {statusText(thread)} · {relativeTime(thread.updatedAt)}
              </span>
            </span>
          </button>
        ))}
        {props.hasMore ? (
          <button
            className="load-more-threads"
            onClick={props.onLoadMore}
            disabled={props.loading}
          >
            加载更多
          </button>
        ) : null}
      </nav>

      <footer className="sidebar-footer">
        <span>{props.connection.appServerVersion ?? "Codex offline"}</span>
        <button
          className="icon-button"
          onClick={props.onLogout}
          title="退出"
          aria-label="退出"
        >
          <LogOut size={17} />
        </button>
      </footer>
    </aside>
  );
}
