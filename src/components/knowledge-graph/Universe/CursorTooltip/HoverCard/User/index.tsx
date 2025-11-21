import CheckIcon from "@/components/Icons/CheckIcon";
import PersonIcon from "@/components/Icons/PersonIcon";
import { Node } from "@Universe/types";
import { Avatar, TooltipContainer } from "../index";

type Props = {
  node: Node;
};

export const User = ({ node }: Props) => {
  const properties = node.properties || {};

  const {
    username,
    twitter_handle: twitterHandle,
    image_url: imageUrl,
    followers: followersCount,
    verified,
    alias,
  } = properties as {
    username?: string;
    twitter_handle?: string;
    image_url?: string;
    followers?: number;
    verified?: boolean;
    alias?: string;
  };

  const displayName = alias || twitterHandle || username || "";
  const displaySubName = twitterHandle || alias || username || "";

  let profileUrl = "";

  if (username) {
    profileUrl = `https://x.com/${alias}`;
  } else if (twitterHandle) {
    profileUrl = `https://x.com/${twitterHandle}`;
  }

  return (
    <TooltipContainer>
      <div className="grid w-fit grid-cols-[auto_minmax(0,1fr)] items-start pb-[15px]">
        <div className="mr-2.5">
          {imageUrl ? (
            <Avatar alt={displayName} src={imageUrl} />
          ) : (
            <div className="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center text-white text-2xl">
              <PersonIcon />
            </div>
          )}
        </div>

        <div className="flex flex-col gap-0.5">
          <div className="flex items-center flex-row gap-2 flex-nowrap w-full">
            <a
              href={profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="font-barlow text-[15px] font-bold text-white no-underline leading-tight whitespace-nowrap overflow-hidden text-ellipsis max-w-full hover:underline"
            >
              {displayName}
            </a>
            {!verified && (
              <div className="bg-[#1d9bf0] rounded-full w-[18px] h-[18px] text-[15px] flex items-center justify-center flex-shrink-0">
                <CheckIcon className="w-3 h-3 text-gray-100" />
              </div>
            )}
          </div>
          <a
            href={profileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="font-barlow text-sm font-normal text-white/60 no-underline leading-tight whitespace-nowrap overflow-hidden text-ellipsis max-w-full hover:underline"
          >
            @{displaySubName}
          </a>
          {followersCount && (
            <p className="font-barlow text-[13px] text-white/60 leading-tight mt-1">
              {followersCount.toLocaleString()} Followers
            </p>
          )}
        </div>
      </div>
    </TooltipContainer>
  );
};
