import React, { useState, useEffect, useCallback, useMemo } from "react";
import { Box, Button, Text } from "@chakra-ui/react";
import { Ace } from "ace-builds";
import { FileEditor } from "@/components/file-editor";
import { getFiles } from "@/utils/docker-compose";
import { EnvironmentVariable } from "@/types";

interface ReviewPoolEnvironmentStepProps {
  repoName: string;
  projectName: string;
  services: any[];
  onNext: () => void;
  poolName?: string;
  swarmId: string;
  workspaceId: string;
}

export const ReviewPoolEnvironmentStep: React.FC<ReviewPoolEnvironmentStepProps> = ({
  repoName,
  projectName,
  services,
  onNext,
  poolName,
  swarmId,
  workspaceId,
}) => {
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [originalContents, setOriginalContents] = useState<Record<string, string>>({});
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [editor, setEditor] = useState<Ace.Editor | null>(null);

  const envVars = useMemo(() => {
    return services.reduce<EnvironmentVariable[]>((acc, service) => {
      const envs = Object.entries(service.env).map(([name, value]) => ({
        name,
        value,
        show: true,
      }));
      return [...acc, ...envs];
    }, []);
  }, [services]);

  const files = useMemo(() => {
    return getFiles(repoName, projectName, services, envVars);
  }, [repoName, projectName, services, envVars]);

  useEffect(() => {
    const initialContents: Record<string, string> = {};
    files.forEach(file => {
      initialContents[file.name] = file.content;
    });
    setOriginalContents(initialContents);
    setFileContents(initialContents);
  }, [files]);

  const handleContentChange = useCallback((fileName: string, value: string) => {
    setFileContents(prev => ({ ...prev, [fileName]: value }));
  }, []);

  const isFileModified = useCallback((fileName: string) => {
    return fileContents[fileName] !== originalContents[fileName];
  }, [fileContents, originalContents]);

  const resetFiles = useCallback(() => {
    setFileContents(originalContents);
  }, [originalContents]);

  const hasModifications = useMemo(() => {
    return Object.keys(fileContents).some(fileName => isFileModified(fileName));
  }, [fileContents, isFileModified]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        resetFiles();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [resetFiles]);

  const handleNext = useCallback(async() => {
    if(poolName) {
      onNext();
      return;
    }
    
    const base64EncodedFiles = 
      Object.entries(fileContents).reduce((acc, [name, content]) => {
        acc[name] = Buffer.from(content).toString("base64")
        return acc
      }, {} as Record<string, string>)

    try {
      await fetch("/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({ container_files: base64EncodedFiles, swarmId: swarmId, workspaceId: workspaceId }),
      });

      onNext();
    } catch (error) {
      console.error(error);
    }
  }, [onNext, fileContents, poolName, swarmId, workspaceId]);

  return (
    <Box height="100%" display="flex" flexDirection="column">
      <Text fontSize="lg" fontWeight="bold" mb={4}>
        Review and Edit Environment
      </Text>
      
      <Box flex="1" mb={4} overflow="hidden">
        <FileEditor
          files={files}
          selectedFile={selectedFile}
          setSelectedFile={setSelectedFile}
          content={selectedFile ? fileContents[selectedFile] : ""}
          onContentChange={value => {
            if (selectedFile) {
              handleContentChange(selectedFile, value);
            }
          }}
          editor={editor}
          setEditor={setEditor}
          isFileModified={isFileModified}
        />
      </Box>
      
      <Box display="flex" justifyContent="space-between">
        {hasModifications && (
          <Button variant="outline" onClick={resetFiles}>
            Reset Changes
          </Button>
        )}
        <Button
          ml="auto"
          onClick={handleNext}
        >
          Next
        </Button>
      </Box>
    </Box>
  );
};

export default ReviewPoolEnvironmentStep;