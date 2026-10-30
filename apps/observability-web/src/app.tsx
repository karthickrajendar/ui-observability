import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import GridLayout, { useContainerWidth, type Layout } from 'react-grid-layout';
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Copy,
  Filter,
  GitBranch,
  LayoutDashboard,
  Menu,
  Moon,
  Pencil,
  Plus,
  Radio,
  RotateCcw,
  Save,
  ShieldAlert,
  Sun,
  Trash2,
  X,
} from 'lucide-react';
import {
  createWidget,
  dashboardSchema,
  presets,
  widgetCatalog,
  widgetById,
  widgetInstanceSchema,
  type DashboardDefinition,
  type FilterOptions,
  type TelemetryEvent,
  type WidgetInstance,
  type WidgetResult,
} from '@ui-observability/contracts';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Select } from './components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from './components/ui/dialog';
import { Inspector } from './components/inspector';
import { WidgetPanel } from './components/widgets';
import { request, retainResults } from './lib/api';
import {
  allDashboards,
  loadDashboards,
  readFilters,
  reorderWidgets,
  saveDashboards,
  toFilters,
  type FilterState,
} from './lib/state';
import { cn, localDate } from './lib/utils';

const icons = [LayoutDashboard, ShieldAlert, BarChart3, GitBranch];
const navNames = [
  'RUM Overview',
  'Frontend Errors',
  'Frontend Metrics',
  'Distributed Traces',
];
const rangeOptions = [
  { value: '900000', label: 'Last 15 minutes' },
  { value: '3600000', label: 'Last 1 hour' },
  { value: '21600000', label: 'Last 6 hours' },
  { value: '86400000', label: 'Last 24 hours' },
  { value: 'custom', label: 'Custom range…' },
];
const refreshOptions = [
  { value: '0', label: 'Refresh off' },
  { value: '10000', label: 'Every 10s' },
  { value: '30000', label: 'Every 30s' },
  { value: '60000', label: 'Every 1m' },
  { value: '300000', label: 'Every 5m' },
];
const optionList = (values: string[], current: string, all: string) => [
  { value: '__all', label: all },
  ...[...new Set([...values, ...(current ? [current] : [])])].map((v) => ({
    value: v,
    label: v,
  })),
];

export default function App() {
  const [params, setParams] = useSearchParams();
  const state = useMemo(() => readFilters(params), [params]);
  const dashboardId = params.get('dashboard') ?? 'rum';
  const [loaded] = useState(() => {
    try {
      return loadDashboards(localStorage);
    } catch {
      return { dashboards: [], warning: 'Browser storage is unavailable.' };
    }
  });
  const [saved, setSaved] = useState(loaded.dashboards);
  const [notice, setNotice] = useState(loaded.warning ?? '');
  const [collapsed, setCollapsed] = useState(false),
    [mobileNav, setMobileNav] = useState(false);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('pulse:theme') ?? 'dark';
    } catch {
      return 'dark';
    }
  });
  const [draft, setDraft] = useState<DashboardDefinition | null>(null);
  const [modal, setModal] = useState<
    | 'new'
    | 'duplicate'
    | 'delete'
    | 'reset'
    | 'catalog'
    | 'time'
    | 'help'
    | null
  >(null);
  const [name, setName] = useState(''),
    [catalogSearch, setCatalogSearch] = useState(''),
    [catalogCategory, setCatalogCategory] = useState('All');
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<TelemetryEvent>();
  const [advanced, setAdvanced] = useState(
    Boolean(state.route || state.browser || state.sessionId || state.search),
  );
  const dashboards = allDashboards(saved);
  const current = dashboards.find((d) => d.id === dashboardId);
  const dashboard = draft?.id === dashboardId ? draft : current;
  const editing = Boolean(draft && draft.id === dashboardId);
  const isPreset = presets.some((d) => d.id === dashboardId);
  const queryClient = useQueryClient();
  const health = useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) =>
      request<{ loki: boolean; tempo: boolean }>('health', undefined, signal),
    refetchInterval: 10000,
  });
  const online = health.data?.loki && health.data?.tempo;
  const filters = useQuery({
    queryKey: ['filters', state],
    queryFn: ({ signal }) =>
      request<FilterOptions>('filters', toFilters(state), signal),
    refetchInterval: state.refresh || false,
  });
  const queryWidgets = (dashboard?.widgets ?? [])
    .filter((w) => w.catalogId !== 'traces')
    .map(({ id, catalogId, settings }) => ({ id, catalogId, settings }));
  const widgetKey = ['widgets', state, queryWidgets];
  const query = useQuery({
    queryKey: widgetKey,
    queryFn: async ({ signal }) => {
      const response = await request<{ results: WidgetResult[] }>(
        'widgets/query',
        { filters: toFilters(state), widgets: queryWidgets },
        signal,
      );
      const previous = queryClient.getQueryData<{ results: WidgetResult[] }>(
        widgetKey,
      );
      return { results: retainResults(response.results, previous?.results) };
    },
    enabled: queryWidgets.length > 0,
    refetchInterval: state.refresh || false,
  });
  function update(values: Record<string, string | undefined>) {
    setParams((old) => {
      const next = new URLSearchParams(old);
      Object.entries(values).forEach(([key, value]) => {
        if (value === undefined || value === '' || value === '__all')
          next.delete(key);
        else next.set(key, value);
      });
      return next;
    });
  }
  function navigate(id: string) {
    window.scrollTo({ top: 0, behavior: 'instant' });
    setDraft(null);
    setSelectedEvent(undefined);
    setMobileNav(false);
    update({ dashboard: id, trace: undefined });
  }
  function persist(items: DashboardDefinition[]): boolean {
    try {
      saveDashboards(localStorage, items);
      setSaved(items);
      return true;
    } catch (error) {
      setNotice(
        error instanceof Error
          ? 'Could not save dashboard: ' + error.message
          : 'Could not save dashboard. Check browser storage.',
      );
      return false;
    }
  }
  function openTrace(id: string) {
    setSelectedEvent(undefined);
    update({ trace: id });
  }
  function changeTheme() {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      localStorage.setItem('pulse:theme', next);
    } catch {
      /* Theme remains usable for this session. */
    }
  }
  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.style.colorScheme = theme;
  }, [theme]);
  const results = new Map(query.data?.results.map((r) => [r.id, r]));
  const errorCount = query.data?.results.filter((r) => r.error).length ?? 0;
  const widgetToConfigure = dashboard?.widgets.find((w) => w.id === settingsId);
  const refresh = () => {
    void queryClient.invalidateQueries({
      predicate: (q) =>
        ['widgets', 'filters', 'trace-search', 'health'].includes(
          String(q.queryKey[0]),
        ),
    });
  };
  return (
    <div className={cn('app-shell', collapsed && 'sidebar-collapsed')}>
      {mobileNav && (
        <button
          className="mobile-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={cn('sidebar', mobileNav && 'mobile-open')}>
        <a className="brand" href="/" aria-label="Pulse home">
          <span className="brand-icon">
            <Activity size={23} strokeWidth={2} />
          </span>
          <span>
            pulse<span className="brand-period">.</span>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-avatar">F</span>
          <div>
            <strong>Frontend workspace</strong>
            <small>Local development</small>
          </div>
          <span className="local-pill">LOCAL</span>
        </div>
        <div className="nav-heading">
          <span>OBSERVABILITY</span>
        </div>
        <nav aria-label="Dashboards">
          {presets.map((item, i) => {
            const Icon = icons[i];
            return (
              <button
                key={item.id}
                className={cn('nav-item', item.id === dashboardId && 'active')}
                disabled={editing}
                onClick={() => navigate(item.id)}
                title={navNames[i]}
              >
                <Icon size={17} />
                <span>{navNames[i]}</span>
                {item.id === dashboardId && <i />}
              </button>
            );
          })}
        </nav>
        <div className="nav-heading custom-heading">
          <span>MY DASHBOARDS</span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="New dashboard"
            disabled={editing}
            onClick={() => {
              setName('');
              setModal('new');
            }}
          >
            <Plus />
          </Button>
        </div>
        <nav aria-label="Personal dashboards">
          {dashboards
            .filter((d) => !presets.some((p) => p.id === d.id))
            .map((d) => (
              <button
                key={d.id}
                className={cn('nav-item', d.id === dashboardId && 'active')}
                disabled={editing}
                onClick={() => navigate(d.id)}
              >
                <LayoutDashboard size={16} />
                <span>{d.title}</span>
              </button>
            ))}
        </nav>
        {!saved.some((d) => !presets.some((p) => p.id === d.id)) && (
          <p className="sidebar-hint">
            Your views. Your signals.
            <br />
            Create a dashboard to make it yours.
          </p>
        )}
        <div className="sidebar-bottom">
          <div className="stack-status">
            <span className={cn('status-dot', online ? 'good' : 'warn')} />
            <div>
              <strong>
                {online
                  ? 'All systems connected'
                  : health.isPending
                    ? 'Checking connections'
                    : 'Stack disconnected'}
              </strong>
              <small>
                Loki{' '}
                <span className={health.data?.loki ? 'text-success' : ''}>
                  ●
                </span>{' '}
                <b>·</b> Tempo{' '}
                <span className={health.data?.tempo ? 'text-success' : ''}>
                  ●
                </span>
              </small>
            </div>
          </div>
          <button className="nav-item" onClick={() => setModal('help')}>
            <CircleHelp size={16} />
            <span>About this workspace</span>
            <ArrowUpRight size={13} />
          </button>
          <div className="sidebar-footer">
            <span className="avatar">FE</span>
            <div>
              <strong>Frontend engineering</strong>
              <small>Personal workspace</small>
            </div>
            <button
              onClick={changeTheme}
              aria-label={
                'Switch to ' + (theme === 'dark' ? 'light' : 'dark') + ' theme'
              }
            >
              {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <Button
            variant="ghost"
            size="icon-sm"
            className="desktop-menu"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            onClick={() => setCollapsed(!collapsed)}
          >
            <Menu />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMobileNav(true)}
          >
            <Menu />
          </Button>
          <div className="breadcrumb">
            <span>Workspace</span>
            <ChevronRight size={12} />
            <span>Dashboards</span>
            <ChevronRight size={12} />
            <strong>{dashboard?.title ?? 'Dashboard not found'}</strong>
          </div>
          <div className="topbar-right">
            <span className="live-label">
              <Radio size={12} />
              {online ? 'Live telemetry' : 'Local telemetry'}
            </span>
            <span className="topbar-separator" />
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="About Pulse"
              onClick={() => setModal('help')}
            >
              <CircleHelp />
            </Button>
          </div>
        </header>
        <main>
          {notice && (
            <div className="notice" role="status">
              <Check size={15} />
              <span>{notice}</span>
              <button
                aria-label="Dismiss notification"
                onClick={() => setNotice('')}
              >
                <X size={14} />
              </button>
            </div>
          )}
          {!dashboard ? (
            <div className="missing-dashboard">
              <LayoutDashboard size={32} />
              <h1>Dashboard not found</h1>
              <p>
                Personal dashboards are saved in the browser where they were
                created.
              </p>
              <Button onClick={() => navigate('rum')}>
                Back to RUM Overview
              </Button>
            </div>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">
                    <span />
                    FRONTEND OBSERVABILITY
                  </div>
                  {editing ? (
                    <Input
                      aria-label="Dashboard title"
                      value={dashboard.title}
                      maxLength={80}
                      onChange={(e) =>
                        setDraft({ ...dashboard, title: e.target.value })
                      }
                      className="dashboard-title-input"
                    />
                  ) : (
                    <h1>{dashboard.title}</h1>
                  )}
                  <p>{dashboard.description}</p>
                </div>
                <div className="page-actions">
                  {editing ? (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDraft(null)}
                      >
                        Cancel
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={dashboard.widgets.length >= 40}
                        onClick={() => {
                          setCatalogSearch('');
                          setModal('catalog');
                        }}
                      >
                        <Plus />
                        Add widget
                      </Button>
                      <Button
                        size="sm"
                        onClick={() => {
                          const valid = dashboardSchema.safeParse(draft);
                          if (!valid.success) {
                            setNotice(
                              valid.error.issues[0]?.message ??
                                'Invalid dashboard',
                            );
                            return;
                          }
                          if (
                            persist([
                              ...saved.filter((d) => d.id !== dashboardId),
                              valid.data,
                            ])
                          ) {
                            setDraft(null);
                            setNotice('Dashboard saved in this browser.');
                          }
                        }}
                      >
                        <Save />
                        Save dashboard
                      </Button>
                    </>
                  ) : (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Copy link with current filters"
                        title="Copy link"
                        onClick={() => {
                          void navigator.clipboard
                            .writeText(window.location.href)
                            .then(
                              () =>
                                setNotice(
                                  'Link copied. Personal dashboard layouts remain in this browser.',
                                ),
                              () =>
                                setNotice(
                                  'Could not copy the link. Copy the address from your browser.',
                                ),
                            );
                        }}
                      >
                        <Copy />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Duplicate dashboard"
                        title="Duplicate dashboard"
                        onClick={() => {
                          setName(dashboard.title + ' copy');
                          setModal('duplicate');
                        }}
                      >
                        <Plus />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={
                          isPreset ? 'Reset dashboard' : 'Delete dashboard'
                        }
                        title={
                          isPreset ? 'Reset to preset' : 'Delete dashboard'
                        }
                        onClick={() => setModal(isPreset ? 'reset' : 'delete')}
                      >
                        {isPreset ? <RotateCcw /> : <Trash2 />}
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setDraft(structuredClone(dashboard))}
                      >
                        <Pencil />
                        Edit dashboard
                      </Button>
                    </>
                  )}
                </div>
              </div>
              <div className="filter-toolbar">
                <div className="filter-group">
                  <label>Application</label>
                  <Select
                    label="Application"
                    value={state.app || '__all'}
                    onChange={(v) =>
                      update({
                        app: v,
                        environment: undefined,
                        release: undefined,
                      })
                    }
                    options={optionList(
                      filters.data?.apps ?? [],
                      state.app,
                      'All applications',
                    )}
                  />
                </div>
                <div className="filter-group">
                  <label>Environment</label>
                  <Select
                    label="Environment"
                    value={state.environment || '__all'}
                    onChange={(v) =>
                      update({ environment: v, release: undefined })
                    }
                    options={optionList(
                      filters.data?.environments ?? [],
                      state.environment,
                      'All environments',
                    )}
                  />
                </div>
                <div className="filter-group">
                  <label>Release</label>
                  <Select
                    label="Release"
                    value={state.release || '__all'}
                    onChange={(v) => update({ release: v })}
                    options={optionList(
                      filters.data?.releases ?? [],
                      state.release,
                      'All releases',
                    )}
                  />
                </div>
                <div className="filter-time">
                  <Clock3 size={14} />
                  <Select
                    label="Time range"
                    value={state.from ? 'custom' : String(state.range)}
                    onChange={(v) =>
                      v === 'custom'
                        ? setModal('time')
                        : update({ range: v, from: undefined, to: undefined })
                    }
                    options={rangeOptions}
                  />
                </div>
                <div className="refresh-group">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label="Refresh data"
                    title="Refresh data"
                    onClick={refresh}
                  >
                    <RotateCcw
                      className={query.isFetching ? 'refresh-spinning' : ''}
                    />
                  </Button>
                  <Select
                    label="Auto refresh"
                    value={String(state.refresh)}
                    onChange={(v) => update({ refresh: v })}
                    options={refreshOptions}
                  />
                </div>
                <Button
                  variant={advanced ? 'default' : 'ghost'}
                  size="icon"
                  aria-label="Toggle signal filters"
                  title="Signal filters"
                  onClick={() => setAdvanced(!advanced)}
                >
                  <Filter />
                </Button>
              </div>
              {state.from !== undefined && (
                <div className="range-caption">
                  {new Date(state.from).toLocaleString()} →{' '}
                  {new Date(state.to ?? Date.now()).toLocaleString()}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => update({ from: undefined, to: undefined })}
                  >
                    <X />
                    Relative range
                  </Button>
                </div>
              )}
              {advanced && (
                <SignalFilters
                  key={JSON.stringify([
                    state.route,
                    state.browser,
                    state.sessionId,
                    state.search,
                  ])}
                  state={state}
                  onApply={update}
                  tracesOnly={dashboard.id === 'traces'}
                />
              )}
              {health.isError ? (
                <div className="connection-banner">
                  <span className="status-dot warn" />
                  <span>
                    The dashboard API is disconnected. Start the local API to
                    query your telemetry.
                  </span>
                </div>
              ) : (
                health.data &&
                !online && (
                  <div className="connection-banner">
                    <span className="status-dot warn" />
                    <span>
                      {!health.data.loki && !health.data.tempo
                        ? 'Loki and Tempo are disconnected.'
                        : !health.data.loki
                          ? 'Loki is disconnected.'
                          : 'Tempo is disconnected.'}{' '}
                      Available signals remain accessible.
                    </span>
                  </div>
                )
              )}
              {filters.data?.warnings.length ? (
                <details className="discovery-warning">
                  <summary>Filter discovery is incomplete</summary>
                  {filters.data.warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </details>
              ) : null}
              <div className="section-heading">
                <span>
                  <LayoutDashboard size={14} />
                  {editing
                    ? 'Customize your dashboard'
                    : 'Experience at a glance'}
                  <b>{dashboard.widgets.length} widgets</b>
                </span>
                <small>
                  {editing
                    ? 'Drag to arrange · use widget settings for size'
                    : errorCount
                      ? errorCount +
                        ' widget' +
                        (errorCount > 1 ? 's' : '') +
                        ' unavailable'
                      : query.isFetching
                        ? 'Updating…'
                        : query.dataUpdatedAt
                          ? 'Updated ' +
                            new Date(query.dataUpdatedAt).toLocaleTimeString(
                              [],
                              { hour: '2-digit', minute: '2-digit' },
                            )
                          : 'Live from your local stack'}
                </small>
              </div>
              {dashboard.widgets.length ? (
                <DashboardGrid
                  dashboard={dashboard}
                  editing={editing}
                  onLayout={(layout) => {
                    if (!draft) return;
                    setDraft({
                      ...draft,
                      widgets: draft.widgets.map((w) => {
                        const position = layout.find((l) => l.i === w.id);
                        return position
                          ? {
                              ...w,
                              x: position.x,
                              y: position.y,
                              w: position.w,
                              h: position.h,
                            }
                          : w;
                      }),
                    });
                  }}
                  renderWidget={(widget) => (
                    <WidgetPanel
                      widget={widget}
                      result={results.get(widget.id)}
                      error={query.error?.message}
                      loading={query.isPending}
                      editing={editing}
                      state={state}
                      onEvent={setSelectedEvent}
                      onTrace={openTrace}
                      onSettings={() => setSettingsId(widget.id)}
                      onRemove={() =>
                        setDraft((previous) =>
                          previous
                            ? {
                                ...previous,
                                widgets: previous.widgets.filter(
                                  (w) => w.id !== widget.id,
                                ),
                              }
                            : previous,
                        )
                      }
                      onMove={(direction) =>
                        setDraft((previous) =>
                          previous
                            ? reorderWidgets(previous, widget.id, direction)
                            : previous,
                        )
                      }
                    />
                  )}
                />
              ) : (
                <div className="blank-dashboard">
                  <LayoutDashboard size={32} />
                  <h2>Your dashboard starts here</h2>
                  <p>Add signals from the widget catalog to build your view.</p>
                  <Button
                    onClick={() => {
                      if (!editing) setDraft(structuredClone(dashboard));
                      setModal('catalog');
                    }}
                  >
                    <Plus />
                    Add your first widget
                  </Button>
                </div>
              )}
              <footer className="dashboard-footer">
                <span>
                  <span className="status-dot neutral" />
                  Observed telemetry · values reflect collected samples
                </span>
                <span>
                  Powered by Loki & Tempo{' '}
                  <span className="footer-mark">pulse.</span>
                </span>
              </footer>
            </>
          )}
        </main>
      </div>
      <Dialog
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
      >
        <DialogContent
          className={modal === 'catalog' ? 'catalog-dialog' : undefined}
        >
          <DialogTitle className="text-lg font-semibold">
            {modal === 'new'
              ? 'Create a dashboard'
              : modal === 'duplicate'
                ? 'Duplicate dashboard'
                : modal === 'catalog'
                  ? 'Widget catalog'
                  : modal === 'time'
                    ? 'Custom time range'
                    : modal === 'help'
                      ? 'Your frontend, in focus.'
                      : modal === 'delete'
                        ? 'Delete this dashboard?'
                        : 'Reset to the original preset?'}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {modal === 'catalog'
              ? 'Pick a signal to add to your dashboard. All widgets use your current filters.'
              : modal === 'time'
                ? 'Choose local dates and times, up to seven days apart.'
                : modal === 'help'
                  ? 'Pulse brings your real frontend telemetry into one workspace.'
                  : modal === 'delete' || modal === 'reset'
                    ? 'This replaces the saved configuration for this dashboard in this browser.'
                    : 'Dashboards and layouts are saved privately in this browser.'}
          </DialogDescription>
          {(modal === 'new' || modal === 'duplicate') && (
            <form
              className="space-y-5"
              onSubmit={(e) => {
                e.preventDefault();
                const id = 'custom-' + crypto.randomUUID();
                const created: DashboardDefinition = {
                  id,
                  title: name.trim(),
                  description:
                    modal === 'duplicate'
                      ? (dashboard?.description ?? '')
                      : 'Your personal view of frontend telemetry.',
                  widgets:
                    modal === 'duplicate'
                      ? structuredClone(dashboard?.widgets ?? [])
                      : [],
                };
                if (persist([...saved, created])) {
                  setModal(null);
                  navigate(id);
                  if (!created.widgets.length) setDraft(created);
                  setNotice('Dashboard created.');
                }
              }}
            >
              <label className="form-label">
                Dashboard name
                <Input
                  autoFocus
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={80}
                  placeholder="e.g. Checkout experience"
                />
              </label>
              <Button type="submit" disabled={!name.trim()}>
                <Plus />
                {modal === 'duplicate' ? 'Create copy' : 'Create dashboard'}
              </Button>
            </form>
          )}
          {modal === 'catalog' && (
            <>
              <div className="catalog-filters">
                <Input
                  aria-label="Search widgets"
                  autoFocus
                  placeholder="Search signals, metrics, and widgets…"
                  value={catalogSearch}
                  onChange={(e) => setCatalogSearch(e.target.value)}
                />
                <Select
                  label="Widget category"
                  value={catalogCategory}
                  onChange={setCatalogCategory}
                  options={['All', 'RUM', 'Errors', 'Metrics', 'Traces'].map(
                    (v) => ({ value: v, label: v }),
                  )}
                />
              </div>
              <div className="catalog-grid">
                {widgetCatalog
                  .filter(
                    (w) =>
                      (catalogCategory === 'All' ||
                        w.category === catalogCategory) &&
                      (w.title + w.description)
                        .toLowerCase()
                        .includes(catalogSearch.toLowerCase()),
                  )
                  .map((w) => (
                    <button
                      className="catalog-card"
                      key={w.id}
                      disabled={(draft?.widgets.length ?? 0) >= 40}
                      onClick={() => {
                        if (!draft) return;
                        const y = Math.max(
                          0,
                          ...draft.widgets.map((v) => v.y + v.h),
                        );
                        setDraft({
                          ...draft,
                          widgets: [
                            ...draft.widgets,
                            createWidget(w.id, crypto.randomUUID(), y),
                          ],
                        });
                        setModal(null);
                      }}
                    >
                      <div>
                        <span>
                          {w.category} / {w.kind}
                        </span>
                        <Plus size={15} />
                      </div>
                      <strong>{w.title}</strong>
                      <p>{w.description}</p>
                    </button>
                  ))}
              </div>
            </>
          )}
          {modal === 'time' && (
            <CustomTime
              state={state}
              onApply={(from, to) => {
                update({ from: String(from), to: String(to) });
                setModal(null);
              }}
            />
          )}
          {(modal === 'delete' || modal === 'reset') && (
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setModal(null)}>
                Cancel
              </Button>
              <Button
                variant={modal === 'delete' ? 'destructive' : 'default'}
                onClick={() => {
                  if (persist(saved.filter((d) => d.id !== dashboardId))) {
                    setModal(null);
                    if (modal === 'delete') navigate('rum');
                    setNotice(
                      modal === 'delete'
                        ? 'Dashboard deleted.'
                        : 'Original preset restored.',
                    );
                  }
                }}
              >
                {modal === 'delete' ? 'Delete dashboard' : 'Reset dashboard'}
              </Button>
            </div>
          )}
          {modal === 'help' && (
            <div className="about-content">
              <p>
                Explore RUM, errors, frontend metrics, and distributed traces
                from the instrumented demo app. Filters and time ranges follow
                your URL; custom layouts stay in this browser.
              </p>
              <div>
                <span className="service-label">
                  <i />
                  Loki
                </span>
                <p>Sessions, events, errors, and frontend measurements.</p>
              </div>
              <div>
                <span className="service-label">
                  <i />
                  Tempo
                </span>
                <p>
                  Complete traces, including browser, API, and database spans.
                </p>
              </div>
              <p className="text-xs text-muted-foreground">
                Measurements reflect observed samples. Older traces may have no
                release attribute. Trace retention is configured separately from
                RUM retention.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>
      {widgetToConfigure && (
        <WidgetSettingsDialog
          key={widgetToConfigure.id}
          widget={widgetToConfigure}
          measurements={filters.data?.measurements ?? []}
          onClose={() => setSettingsId(null)}
          onSave={(widget) => {
            setDraft((previous) =>
              previous
                ? {
                    ...previous,
                    widgets: previous.widgets.map((w) =>
                      w.id === widget.id ? widget : w,
                    ),
                  }
                : previous,
            );
            setSettingsId(null);
          }}
        />
      )}
      <Inspector
        traceId={params.get('trace') ?? undefined}
        event={selectedEvent}
        onClose={() => {
          setSelectedEvent(undefined);
          update({ trace: undefined });
        }}
        onTrace={openTrace}
      />
    </div>
  );
}
function DashboardGrid({
  dashboard,
  editing,
  onLayout,
  renderWidget,
}: {
  dashboard: DashboardDefinition;
  editing: boolean;
  onLayout: (layout: Layout) => void;
  renderWidget: (widget: WidgetInstance) => React.ReactNode;
}) {
  const { width, containerRef, mounted } = useContainerWidth();
  return (
    <div ref={containerRef} className="dashboard-grid">
      {mounted &&
        (width < 700 ? (
          <div className="mobile-widget-grid">
            {[...dashboard.widgets]
              .sort((a, b) => a.y - b.y || a.x - b.x)
              .map((widget) => (
                <div
                  key={widget.id}
                  style={{ height: Math.max(190, widget.h * 43) }}
                >
                  {renderWidget(widget)}
                </div>
              ))}
          </div>
        ) : (
          <GridLayout
            width={width}
            layout={dashboard.widgets.map((w) => ({
              i: w.id,
              x: w.x,
              y: w.y,
              w: w.w,
              h: w.h,
              minW: 3,
              minH: 3,
              maxH: 20,
            }))}
            gridConfig={{
              cols: 12,
              rowHeight: 30,
              margin: [16, 16],
              containerPadding: [0, 0],
            }}
            dragConfig={{
              enabled: editing,
              handle: '.drag-handle',
              cancel: 'button,input',
              allowMobileScroll: true,
            }}
            resizeConfig={{ enabled: editing }}
            onDragStop={(layout) => onLayout(layout)}
            onResizeStop={(layout) => onLayout(layout)}
          >
            {dashboard.widgets.map((widget) => (
              <div key={widget.id}>{renderWidget(widget)}</div>
            ))}
          </GridLayout>
        ))}
    </div>
  );
}
function SignalFilters({
  state,
  tracesOnly,
  onApply,
}: {
  state: FilterState;
  tracesOnly: boolean;
  onApply: (values: Record<string, string | undefined>) => void;
}) {
  const [values, setValues] = useState({
    route: state.route,
    browser: state.browser,
    sessionId: state.sessionId,
    search: state.search,
  });
  return (
    <form
      className="signal-filters"
      onSubmit={(e) => {
        e.preventDefault();
        onApply(values);
      }}
    >
      {!tracesOnly && (
        <>
          <Input
            aria-label="Route or view filter"
            placeholder="Exact route or view"
            value={values.route}
            onChange={(e) => setValues({ ...values, route: e.target.value })}
          />
          <Input
            aria-label="Browser filter"
            placeholder="Exact browser name"
            value={values.browser}
            onChange={(e) => setValues({ ...values, browser: e.target.value })}
          />
          <Input
            aria-label="Event text filter"
            placeholder="Contains text…"
            value={values.search}
            onChange={(e) => setValues({ ...values, search: e.target.value })}
          />
        </>
      )}
      {!tracesOnly && (
        <Input
          aria-label="Session ID filter"
          placeholder="Exact session ID"
          value={values.sessionId}
          onChange={(e) => setValues({ ...values, sessionId: e.target.value })}
        />
      )}
      {!tracesOnly && (
        <Button type="submit" variant="outline" size="sm">
          <Filter />
          Apply
        </Button>
      )}
      <Button
        variant="ghost"
        size="sm"
        onClick={() =>
          onApply({
            route: undefined,
            browser: undefined,
            sessionId: undefined,
            search: undefined,
          })
        }
      >
        Clear
      </Button>
      <small>
        Route, browser, session, and text filters apply to RUM and measurement
        records. Trace widgets use their own search controls.
      </small>
    </form>
  );
}
function CustomTime({
  state,
  onApply,
}: {
  state: FilterState;
  onApply: (from: number, to: number) => void;
}) {
  const [from, setFrom] = useState(
      localDate(state.from ?? Date.now() - state.range),
    ),
    [to, setTo] = useState(localDate(state.to ?? Date.now()));
  const [error, setError] = useState('');
  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        const start = new Date(from).getTime(),
          end = new Date(to).getTime();
        if (
          !Number.isFinite(start) ||
          !Number.isFinite(end) ||
          start < 0 ||
          end <= start ||
          end - start > 7 * 86400000
        ) {
          setError('Choose a valid range, up to seven days long.');
          return;
        }
        onApply(start, end);
      }}
    >
      <label className="form-label">
        From
        <Input
          type="datetime-local"
          required
          value={from}
          onChange={(e) => setFrom(e.target.value)}
        />
      </label>
      <label className="form-label">
        To
        <Input
          type="datetime-local"
          required
          value={to}
          onChange={(e) => setTo(e.target.value)}
        />
      </label>
      {error && (
        <p className="inline-error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit">Apply time range</Button>
    </form>
  );
}
function WidgetSettingsDialog({
  widget,
  measurements,
  onSave,
  onClose,
}: {
  widget: WidgetInstance;
  measurements: FilterOptions['measurements'];
  onSave: (widget: WidgetInstance) => void;
  onClose: () => void;
}) {
  const [value, setValue] = useState(structuredClone(widget)),
    [error, setError] = useState('');
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent>
        <DialogTitle className="text-lg font-semibold">
          Widget settings
        </DialogTitle>
        <DialogDescription className="text-sm text-muted-foreground">
          {widgetById[widget.catalogId].description}
        </DialogDescription>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const result = widgetInstanceSchema.safeParse(value);
            if (result.success) onSave(result.data);
            else
              setError(result.error.issues[0]?.message ?? 'Invalid settings');
          }}
        >
          <label className="form-label">
            Title
            <Input
              required
              maxLength={100}
              value={value.title}
              onChange={(e) => setValue({ ...value, title: e.target.value })}
            />
          </label>
          <div className="grid grid-cols-2 gap-4">
            <label className="form-label">
              Width (grid columns)
              <Input
                type="number"
                min={3}
                max={12}
                required
                value={value.w}
                onChange={(e) => {
                  const w = Number(e.target.value);
                  setValue({
                    ...value,
                    w,
                    x: Math.max(0, Math.min(value.x, 12 - w)),
                  });
                }}
              />
            </label>
            <label className="form-label">
              Height (grid rows)
              <Input
                type="number"
                min={3}
                max={20}
                required
                value={value.h}
                onChange={(e) =>
                  setValue({ ...value, h: Number(e.target.value) })
                }
              />
            </label>
          </div>
          {widget.catalogId === 'custom-measurements' && (
            <>
              <label className="form-label">
                Measurement type
                <Input
                  list="measurement-types"
                  placeholder="All custom types"
                  value={value.settings.measurementType ?? ''}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      settings: {
                        ...value.settings,
                        measurementType: e.target.value,
                      },
                    })
                  }
                />
                <datalist id="measurement-types">
                  {[...new Set(measurements.map((m) => m.type))].map((type) => (
                    <option key={type} value={type} />
                  ))}
                </datalist>
              </label>
              <label className="form-label">
                Numeric field
                <Input
                  required
                  pattern="[a-zA-Z_][a-zA-Z0-9_]*"
                  list="measurement-fields"
                  value={value.settings.measurementField ?? 'duration_ms'}
                  onChange={(e) =>
                    setValue({
                      ...value,
                      settings: {
                        ...value.settings,
                        measurementField: e.target.value,
                      },
                    })
                  }
                />
                <datalist id="measurement-fields">
                  {[
                    ...new Set(
                      measurements
                        .filter(
                          (m) =>
                            !value.settings.measurementType ||
                            m.type === value.settings.measurementType,
                        )
                        .map((m) => m.field),
                    ),
                  ].map((field) => (
                    <option key={field} value={field} />
                  ))}
                </datalist>
              </label>
              <label className="form-label">
                Unit
                <Select
                  label="Measurement unit"
                  value={value.settings.unit ?? 'ms'}
                  onChange={(unit) =>
                    setValue({
                      ...value,
                      settings: {
                        ...value.settings,
                        unit: unit as 'ms' | 'number' | 'percent' | 'ratio',
                      },
                    })
                  }
                  options={[
                    { value: 'ms', label: 'Milliseconds' },
                    { value: 'number', label: 'Number' },
                    { value: 'percent', label: 'Percentage' },
                    { value: 'ratio', label: 'Ratio / score' },
                  ]}
                />
              </label>
            </>
          )}
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">
              <Check />
              Apply settings
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
