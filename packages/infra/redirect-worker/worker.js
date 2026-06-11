// Redirect worker: www.careerpin.app, careerpin.io, www.careerpin.io → careerpin.app
// Deployed per the Domain Decision: /WIC/issues/WIC-502#document-domain-decision
// Note: careerpin.com is NOT a route here — it is owned by a 2018 squatter and is not in scope.
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = `https://careerpin.app${url.pathname}${url.search}`;
    return Response.redirect(target, 301);
  },
};
