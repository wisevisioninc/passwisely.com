// Controller tests exercise loaded views while leaving React's asynchronous
// scheduler to the real streaming-render tests. Resolve the production import
// factories; never substitute Dashboard or QR implementations.
export function lazyComponents() {
  const views = new Map();
  return {
    lazy(load) { const type = {}; views.set(type, { load }); return type; },
    async ready() {
      await Promise.all([...views.values()].map(async view => { view.component = (await view.load()).default; }));
    },
    unwrap(tree) {
      if (Array.isArray(tree)) return tree.map(item => this.unwrap(item));
      if (!tree || typeof tree !== "object" || !tree.props) return tree;
      const view = views.get(tree.type);
      if (view && !view.component) throw new Error("Controller test must await lazy view readiness.");
      return { ...tree, type: view?.component ?? tree.type, props: { ...tree.props, children: this.unwrap(tree.props.children) } };
    },
  };
}
