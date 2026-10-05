import { useEffect, useState } from 'react';
import { api } from '../api';

type Cycle = {
  id: string;
  code: string;
  name: string;
  status: string;
  _count?: { studentCycleStatuses: number };
};

export function CycleSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (id: string) => void;
}) {
  const [cycles, setCycles] = useState<Cycle[]>([]);

  useEffect(() => {
    api.get<Cycle[]>('/selection-cycles').then((data) => {
      if (Array.isArray(data)) {
        setCycles(data);
        if (!value && data.length > 0) {
          const active = data.find((c) => c.status === 'ACTIVE');
          onChange((active ?? data[0]).id);
        }
      }
    }).catch(() => { setCycles([]); });
  }, []);

  return (
    <select className="search-input" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">Select cycle...</option>
      {cycles.map((c) => (
        <option key={c.id} value={c.id}>
          {c.code} — {c.name} ({c.status})
        </option>
      ))}
    </select>
  );
}
