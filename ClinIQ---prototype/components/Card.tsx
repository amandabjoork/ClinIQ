import React from 'react';

export const Card: React.FC<{ children: React.ReactNode; className?: string; title?: string }> = ({ children, className = '', title }) => {
  return (
    <div className={`bg-white rounded-xl shadow-lg border-2 border-slate-300 p-6 ${className}`}>
      {title && <h3 className="text-xl font-extrabold text-slate-900 mb-4">{title}</h3>}
      {children}
    </div>
  );
};