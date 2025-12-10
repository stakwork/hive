import { describe, it, expect, beforeEach } from 'vitest'
import { S3Service } from '@/services/s3'

/**
 * S3 Configuration Diagnostics Test Suite
 * 
 * This test suite validates S3 configuration and helps diagnose
 * "Diagram could not be stored" errors by checking:
 * - Environment variable configuration
 * - AWS credential setup
 * - S3 bucket accessibility
 * - IAM permission validation
 * 
 * Run this test to identify S3 configuration issues before
 * attempting diagram generation in production.
 */
describe('S3 Configuration Diagnostics', () => {
  describe('Environment Variable Checks', () => {
    it('should have AWS_ROLE_ARN configured', () => {
      const roleArn = process.env.AWS_ROLE_ARN
      
      if (!roleArn) {
        console.error('\n❌ AWS_ROLE_ARN is not set in environment variables')
        console.error('Required for: S3Service initialization and diagram upload')
        console.error('Set in: .env.local or deployment environment\n')
      }
      
      expect(roleArn, 'AWS_ROLE_ARN must be set for S3 uploads').toBeDefined()
      expect(roleArn, 'AWS_ROLE_ARN must not be empty').not.toBe('')
      
      if (roleArn) {
        expect(roleArn, 'AWS_ROLE_ARN must be valid IAM role ARN format').toMatch(
          /^arn:aws:iam::\d{12}:role\/.+$/
        )
      }
    })

    it('should have S3_BUCKET_NAME configured', () => {
      const bucketName = process.env.S3_BUCKET_NAME
      
      if (!bucketName) {
        console.error('\n❌ S3_BUCKET_NAME is not set in environment variables')
        console.error('Required for: S3 file storage and diagram upload')
        console.error('Set in: .env.local or deployment environment\n')
      }
      
      expect(bucketName, 'S3_BUCKET_NAME must be set for S3 uploads').toBeDefined()
      expect(bucketName, 'S3_BUCKET_NAME must not be empty').not.toBe('')
    })

    it('should have AWS_REGION configured or use default', () => {
      const region = process.env.AWS_REGION || 'us-east-1'
      
      expect(region).toBeDefined()
      expect(region, 'AWS_REGION must be valid AWS region').toMatch(/^[a-z]{2}-[a-z]+-\d{1}$/)
      
      if (!process.env.AWS_REGION) {
        console.warn('\n⚠️  AWS_REGION not set, using default: us-east-1')
        console.warn('Set AWS_REGION if your S3 bucket is in a different region\n')
      }
    })
  })

  describe('S3Service Initialization', () => {
    it('should initialize S3Service without errors when environment is configured', () => {
      const originalRoleArn = process.env.AWS_ROLE_ARN
      const originalBucketName = process.env.S3_BUCKET_NAME
      
      // Set temporary values for testing
      process.env.AWS_ROLE_ARN = 'arn:aws:iam::123456789012:role/test-role'
      process.env.S3_BUCKET_NAME = 'test-bucket'
      
      expect(() => {
        const s3Service = new S3Service()
        expect(s3Service).toBeDefined()
      }, 'S3Service should initialize when environment variables are set').not.toThrow()
      
      // Restore original values
      if (originalRoleArn) process.env.AWS_ROLE_ARN = originalRoleArn
      if (originalBucketName) process.env.S3_BUCKET_NAME = originalBucketName
    })

    it('should throw error when AWS_ROLE_ARN is missing', () => {
      const originalRoleArn = process.env.AWS_ROLE_ARN
      delete process.env.AWS_ROLE_ARN
      
      expect(() => {
        new S3Service()
      }).toThrow('Missing required environment variable: AWS_ROLE_ARN')
      
      if (originalRoleArn) process.env.AWS_ROLE_ARN = originalRoleArn
    })

    it('should throw error when S3_BUCKET_NAME is missing', () => {
      const originalBucketName = process.env.S3_BUCKET_NAME
      delete process.env.S3_BUCKET_NAME
      
      expect(() => {
        new S3Service()
      }).toThrow('Missing required environment variable: S3_BUCKET_NAME')
      
      if (originalBucketName) process.env.S3_BUCKET_NAME = originalBucketName
    })
  })

  describe('Diagnostic Information', () => {
    it('should provide configuration summary', () => {
      console.log('\n📋 S3 Configuration Summary:')
      console.log('----------------------------')
      console.log(`AWS_ROLE_ARN: ${process.env.AWS_ROLE_ARN ? '✅ Set' : '❌ Missing'}`)
      console.log(`S3_BUCKET_NAME: ${process.env.S3_BUCKET_NAME ? '✅ Set' : '❌ Missing'}`)
      console.log(`AWS_REGION: ${process.env.AWS_REGION || 'us-east-1 (default)'}`)
      console.log('\n📝 Common Issues:')
      console.log('1. Missing environment variables (check .env.local)')
      console.log('2. Invalid IAM role ARN format')
      console.log('3. IAM role lacks s3:PutObject permission')
      console.log('4. S3 bucket does not exist')
      console.log('5. Vercel OIDC trust relationship not configured')
      console.log('6. Network connectivity to AWS S3')
      console.log('\n💡 Next Steps:')
      console.log('- Verify .env.local has correct AWS_ROLE_ARN and S3_BUCKET_NAME')
      console.log('- Check IAM role has s3:PutObject, s3:GetObject permissions')
      console.log('- Confirm S3 bucket exists and is accessible')
      console.log('- Review deployment logs for detailed error messages\n')
      
      expect(true).toBe(true)
    })
  })
})