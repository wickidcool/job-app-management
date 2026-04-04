import { useState, useCallback } from 'react';
import { listProjects, type ProjectMeta } from '../api/client.js';

export function useProjects() {
  const [projects, setProjects] = useState<ProjectMeta[]>([]);
  const refresh = useCallback(async () => {
    const list = await listProjects();
    setProjects(list);
  }, []);
  return { projects, refresh };
}
