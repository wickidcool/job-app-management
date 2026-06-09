// Redirect worker: www.careerpin.com, careerpin.app, careerpin.io → careerpin.com
// Deployed per the Domain Decision: /WIC/issues/WIC-502#document-domain-decision
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = `https://careerpin.com${url.pathname}${url.search}`;
    return Response.redirect(target, 301);
  },
};
