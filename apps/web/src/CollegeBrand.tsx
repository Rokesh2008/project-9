import React from 'react';

export function CollegeBrand({ portal = 'Student Selection Portal' }: { portal?: string }) {
  return <span className="collegeBrand">
    <img src="/branding/st-josephs-logo.png" alt="St. Joseph’s College of Engineering crest" width="64" height="64" />
    <span className="collegeBrandText"><strong>St. Joseph’s</strong><span>College of Engineering</span><small>{portal}</small></span>
  </span>;
}
