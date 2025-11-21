import CheckIcon from "@/components/Icons/CheckIcon";
import PersonIcon from "@/components/Icons/PersonIcon";
import { Node } from "@Universe/types";
import { FaBookmark, FaChartBar, FaComment, FaHeart, FaQuoteRight, FaRetweet } from "react-icons/fa";
import { TooltipContainer } from "../index";

type MetricsProps = {
  metrics: {
    impressions?: number;
    likes?: number;
    replies?: number;
    retweets?: number;
    quotes?: number;
    bookmarks?: number;
  };
};

type Props = {
  node: Node;
};
const MetricsBar = ({ metrics }: MetricsProps) => {
  const formatNumber = (num?: number) => {
    if (!num) {
      return "0";
    }

    return num.toLocaleString();
  };

  return (
    <div className="flex flex-row gap-3 mt-1 w-full justify-center items-center flex-wrap px-2.5">
      {metrics.replies !== undefined && (
        <div className="flex flex-row items-center gap-1 text-white text-[13px] mb-1 min-w-0">
          <span className="text-white min-w-[8px] text-right overflow-hidden text-ellipsis">
            {formatNumber(metrics.replies)}
          </span>
          <FaComment className="w-4 h-4 text-white/60 flex-shrink-0" />
        </div>
      )}
      {metrics.retweets !== undefined && (
        <div className="flex flex-row items-center gap-1 text-white text-[13px] mb-1 min-w-0">
          <span className="text-white min-w-[8px] text-right overflow-hidden text-ellipsis">
            {formatNumber(metrics.retweets)}
          </span>
          <FaRetweet className="w-4 h-4 text-white/60 flex-shrink-0" />
        </div>
      )}
      {metrics.quotes !== undefined && (
        <div className="flex flex-row items-center gap-1 text-white text-[13px] mb-1 min-w-0">
          <span className="text-white min-w-[8px] text-right overflow-hidden text-ellipsis">
            {formatNumber(metrics.quotes)}
          </span>
          <FaQuoteRight className="w-4 h-4 text-white/60 flex-shrink-0" />
        </div>
      )}
      {metrics.likes !== undefined && (
        <div className="flex flex-row items-center gap-1 text-white text-[13px] mb-1 min-w-0">
          <span className="text-white min-w-[8px] text-right overflow-hidden text-ellipsis">
            {formatNumber(metrics.likes)}
          </span>
          <FaHeart className="w-4 h-4 text-white/60 flex-shrink-0" />
        </div>
      )}
      {metrics.bookmarks !== undefined && (
        <div className="flex flex-row items-center gap-1 text-white text-[13px] mb-1 min-w-0">
          <span className="text-white min-w-[8px] text-right overflow-hidden text-ellipsis">
            {formatNumber(metrics.bookmarks)}
          </span>
          <FaBookmark className="w-4 h-4 text-white/60 flex-shrink-0" />
        </div>
      )}
      {metrics.impressions !== undefined && (
        <div className="flex flex-row items-center gap-1 text-white text-[13px] mb-1 min-w-0">
          <span className="text-white min-w-[8px] text-right overflow-hidden text-ellipsis">
            {formatNumber(metrics.impressions)}
          </span>
          <FaChartBar className="w-4 h-4 text-white/60 flex-shrink-0" />
        </div>
      )}
    </div>
  );
};

export const Tweet = ({ node }: Props) => {
  const properties = node.properties || {};
  const nodeType = node.node_type;

  const {
    text,
    tweet_id: tweetId,
    impression_count: impressions,
    like_count: likes,
    reply_count: replies,
    retweet_count: retweets,
    quote_count: quotes,
    bookmark_count: bookmarks,
    image_url: imageUrl,
    twitter_handle: twitterHandle,
    alias,
    verified,
  } = properties as {
    text?: string;
    tweet_id?: string;
    impression_count?: number;
    like_count?: number;
    reply_count?: number;
    retweet_count?: number;
    quote_count?: number;
    bookmark_count?: number;
    image_url?: string;
    twitter_handle?: string;
    alias?: string;
    verified?: boolean;
  };

  let postUrl = "";

  if (nodeType === "Tweet" && tweetId && twitterHandle) {
    postUrl = `https://x.com/${twitterHandle}/status/${tweetId}`;
  }

  const displayName = alias || twitterHandle || "";
  const displaySubName = twitterHandle || alias || "";

  return (
    <TooltipContainer>
      <div className="flex flex-col w-full gap-2">
        <div className="flex flex-row w-full gap-3">
          <div className="flex-shrink-0 w-10">
            {imageUrl ? (
              <img alt={displayName} src={imageUrl} className="w-10 h-10 rounded-full object-cover" />
            ) : (
              <div className="w-10 h-10 rounded-full bg-gray-600 flex items-center justify-center text-white text-2xl">
                <PersonIcon />
              </div>
            )}
          </div>

          <div className="flex flex-col flex-grow min-w-0 max-w-[calc(100%-52px)]">
            <div className="flex items-center flex-row gap-2 flex-wrap w-full mb-1.5">
              <a
                href={postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-barlow text-[15px] font-semibold text-white no-underline overflow-hidden text-ellipsis whitespace-nowrap hover:underline"
              >
                {displayName}
              </a>
              {verified && (
                <div className="bg-[#1d9bf0] rounded-full w-4 h-4 text-[15px] flex items-center justify-center flex-shrink-0 mx-0.5">
                  <CheckIcon className="w-2.5 h-2.5 text-gray-100" />
                </div>
              )}
              <a
                href={postUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-barlow text-[15px] text-white/60 no-underline overflow-hidden text-ellipsis whitespace-nowrap hover:underline"
              >
                @{displaySubName}
              </a>
            </div>

            {text && (
              <div className="font-barlow text-[15px] leading-relaxed text-white m-0 break-words whitespace-pre-wrap overflow-wrap-anywhere w-full max-h-[200px] overflow-y-auto">
                {text}
              </div>
            )}
          </div>
        </div>

        <MetricsBar
          metrics={{
            impressions,
            likes,
            replies,
            retweets,
            quotes,
            bookmarks,
          }}
        />
      </div>
    </TooltipContainer>
  );
};
