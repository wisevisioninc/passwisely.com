// ...existing imports...

interface FormattedSolution {
  code: string;
  approach: string;
  time_complexity: string;
  space_complexity: string;
}

interface SolutionsProps {
  solution: {
    bruteforce: FormattedSolution;
    optimal: FormattedSolution;
  };
  // ...other existing props...
}

export const Solutions: React.FC<SolutionsProps> = ({
  solution,
  // ...other props...
}) => {
  return (
    <div className="space-y-6">
      {/* Bruteforce Solution */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Brute Force Approach</h2>
        <div className="bg-black/40 p-4 rounded-lg">
          <pre className="text-sm text-white/90">{solution.bruteforce.approach}</pre>
        </div>
        <div className="bg-black/40 p-4 rounded-lg">
          <pre className="text-sm text-white/90">
            <code>{solution.bruteforce.code}</code>
          </pre>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-black/40 p-4 rounded-lg">
            <h3 className="text-sm font-medium mb-2">Time Complexity</h3>
            <p className="text-sm text-white/70">{solution.bruteforce.time_complexity}</p>
          </div>
          <div className="bg-black/40 p-4 rounded-lg">
            <h3 className="text-sm font-medium mb-2">Space Complexity</h3>
            <p className="text-sm text-white/70">{solution.bruteforce.space_complexity}</p>
          </div>
        </div>
      </div>

      {/* Optimal Solution */}
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Optimal Approach</h2>
        <div className="bg-black/40 p-4 rounded-lg">
          <pre className="text-sm text-white/90">{solution.optimal.approach}</pre>
        </div>
        <div className="bg-black/40 p-4 rounded-lg">
          <pre className="text-sm text-white/90">
            <code>{solution.optimal.code}</code>
          </pre>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="bg-black/40 p-4 rounded-lg">
            <h3 className="text-sm font-medium mb-2">Time Complexity</h3>
            <p className="text-sm text-white/70">{solution.optimal.time_complexity}</p>
          </div>
          <div className="bg-black/40 p-4 rounded-lg">
            <h3 className="text-sm font-medium mb-2">Space Complexity</h3>
            <p className="text-sm text-white/70">{solution.optimal.space_complexity}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
