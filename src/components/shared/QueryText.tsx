import React, { useEffect } from "react";

interface QuerySelectorProps {
  currentQuery: string;
  setQuery: (query: string) => void;
}

export const QuerySelector: React.FC<QuerySelectorProps> = ({
  currentQuery,
  setQuery,
}) => {
  useEffect(() => {
    // Listen for language change events from main process
    const unsubscribe = window.electronAPI.onQueryChange((newQuery: string) => {
      handleQueryChange(newQuery);
    });

    return () => {
      unsubscribe();
    };
  }, [setQuery]);

  const handleQueryChange = async (newQuery: string) => {
    try {
      // Set the global query variable and update state
      window.__QUERY__ = newQuery;
      setQuery(newQuery);
    } catch (error) {
      console.error("Error in query change:", error);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <input
        type="text"
        value={currentQuery}
        onChange={(e) => handleQueryChange(e.target.value)}
        placeholder="Enter text"
        className="bg-white/10 rounded-md px-2 py-1 text-[11px] leading-none text-white/70"
      />
    </div>
  );
};
