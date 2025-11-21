import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import React, { useState } from "react";
import { FileEditor } from "./FileEditor";
import { FileIcon } from "./FileIcon";

interface FileTabsProps {
  fileContents: Record<string, string>;
  originalContents: Record<string, string>;
  onChange: (fileName: string, content: string) => void;
}

const fileTypeMapper = {
  "devcontainer.json": "json",
  "pm2.config.js": "javascript",
  "docker-compose.yml": "yaml",
  Dockerfile: "dockerfile",
};

export const FileTabs: React.FC<FileTabsProps> = ({ fileContents, originalContents, onChange }) => {
  const [activeTab, setActiveTab] = useState("devcontainer-json");

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
      <TabsList className="grid w-full grid-cols-4">
        {Object.keys(fileContents).map((name) => (
          <TabsTrigger key={name} value={name.toLowerCase().replace(".", "-")} className="flex items-center gap-2">
            <FileIcon type={fileTypeMapper[name as keyof typeof fileTypeMapper]} />
            {name.split(".")[0]}
          </TabsTrigger>
        ))}
      </TabsList>

      {Object.keys(fileContents).map((name) => (
        <TabsContent key={name} value={name.toLowerCase().replace(".", "-")}>
          <FileEditor
            name={name}
            type={fileTypeMapper[name as keyof typeof fileTypeMapper]}
            value={fileContents[name]}
            originalValue={originalContents[name]}
            onChange={(val) => onChange(name, val)}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
};
