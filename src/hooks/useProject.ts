import { useCallback, useEffect, useRef, useState } from 'react';
import { demoProject, parseProject } from '../model/project';
import type { Project } from '../model/types';
import { syncUtilityConnections } from '../model/utility-connections';
const STORE = 'floorplan-studio-v2';
function initial() {
  try {
    const raw = localStorage.getItem(STORE) || localStorage.getItem('huxing-design-v1');
    if (raw) return { project: parseProject(JSON.parse(raw)), error: '' };
  } catch {
    return { project: demoProject(), error: '本地方案无法读取，已载入示例；原始缓存未覆盖，请先导出备份。' };
  }
  return { project: demoProject(), error: '' };
}
export function useProject() {
  const [loaded] = useState(initial),
    [project, setProject] = useState(loaded.project),
    [saveStatus, setSaveStatus] = useState(loaded.error || '已保存到本机');
  const current = useRef(project),
    past = useRef<Project[]>([]),
    future = useRef<Project[]>([]),
    [revision, setRevision] = useState(0),
    [touched, setTouched] = useState(false);
  const commit = useCallback((fn: Project | ((draft: Project) => void)) => {
    const before = current.current;
    const next = typeof fn === 'function' ? structuredClone(before) : fn;
    if (typeof fn === 'function') fn(next);
    syncUtilityConnections(next);
    past.current.push(before);
    if (past.current.length > 60) past.current.shift();
    future.current = [];
    current.current = next;
    setSaveStatus('正在保存…');
    setProject(next);
    setTouched(true);
    setRevision((r) => r + 1);
  }, []);
  const travel = useCallback((redo = false) => {
    const from = redo ? future : past,
      to = redo ? past : future;
    const next = from.current.pop();
    if (!next) return;
    to.current.push(current.current);
    current.current = next;
    setSaveStatus('正在保存…');
    setProject(next);
    setTouched(true);
    setRevision((r) => r + 1);
  }, []);
  useEffect(() => {
    if (!touched) return;
    setSaveStatus('正在保存…');
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(STORE, JSON.stringify(project));
        setSaveStatus('已保存到本机');
      } catch {
        setSaveStatus('本机存储已满，请导出 JSON 保存方案');
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [project, touched]);
  useEffect(() => {
    if (!touched) return;
    const flush = () => {
      try {
        localStorage.setItem(STORE, JSON.stringify(current.current));
      } catch {
        /* visible error is reported by the regular save */
      }
    };
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, [touched]);
  return {
    project,
    commit,
    undo: () => travel(),
    redo: () => travel(true),
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
    saveStatus,
    revision,
  };
}
